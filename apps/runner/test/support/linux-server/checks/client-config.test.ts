/**
 * `client-config.ts` (specs/016-build-from-source, T015; plan items 3 (a)
 * and 13), branch by branch: the markers, `proxies` put into the client's
 * `config.json` and taken out again, the htpasswd line Bun's bcrypt makes,
 * the login's arguments, and what the step's environment shows. Nothing
 * here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  ENV_BEGIN,
  ENV_END,
  htpasswdLine,
  loginArgs,
  PROXY_KEYS,
  proxyDockerfile,
  proxyFindings,
  proxyMarkers,
  proxyWords,
  withoutProxies,
  withProxies,
} from "./client-config"
import { PROXY_NAMES } from "../build-runs/rb7"

const MARKERS = proxyMarkers("0123abcd")
/** The htpasswd line the registry takes (registry.ts). */
const HTPASSWD_LINE = /^[A-Za-z0-9._-]+:\$2[aby]?\$[0-9]{2}\$[./A-Za-z0-9]{53}$/

describe("markers", () => {
  test("one for each key, each its own, all under .invalid", () => {
    expect(Object.keys(MARKERS)).toEqual([...PROXY_KEYS])
    const values = Object.values(MARKERS)
    expect(new Set(values).size).toBe(5)
    for (const value of values) expect(value).toContain(".invalid")
    expect(MARKERS.httpProxy).toBe(
      "http://zekno-l8-0123abcd-httpproxy.invalid:3128"
    )
    expect(MARKERS.noProxy).toBe("zekno-l8-0123abcd-noproxy.invalid")
    expect(MARKERS.allProxy).toBe(
      "socks5://zekno-l8-0123abcd-allproxy.invalid:1080"
    )
  })

  test("refuse a token that is not lower-case hex", () => {
    for (const token of ["", "XYZ", "0123", "abc def0"])
      expect(() => proxyMarkers(token)).toThrow("lower-case hex")
  })
})

describe("config.json", () => {
  test("gets proxies.default, the rest kept, written as the client writes it", () => {
    const text = withProxies(
      '{"auths":{"a":{}},"currentContext":"default"}',
      MARKERS
    )
    expect(JSON.parse(text)).toEqual({
      auths: { a: {} },
      currentContext: "default",
      proxies: { default: { ...MARKERS } },
    })
    expect(text).toStartWith("{\n\t")
    expect(text).toEndWith("}\n")
    expect(JSON.parse(withProxies(undefined, MARKERS))).toEqual({
      proxies: { default: { ...MARKERS } },
    })
  })

  test("one that already has proxies, or is not a JSON object, is left alone", () => {
    expect(() => withProxies('{"proxies":{}}', MARKERS)).toThrow(
      "already has proxies"
    )
    expect(() => withProxies("not json", MARKERS)).toThrow("is not JSON")
    expect(() => withProxies("[]", MARKERS)).toThrow("is not an object")
    expect(() => withoutProxies("null", true)).toThrow("is not an object")
  })

  test("loses its proxies again, and the rest stays", () => {
    const text = withProxies('{"auths":{"a":{}}}', MARKERS)
    expect(JSON.parse(withoutProxies(text, false)!)).toEqual({
      auths: { a: {} },
    })
    expect(JSON.parse(withoutProxies(text, true)!)).toEqual({
      auths: { a: {} },
    })
  })

  test("a file the check made goes once nothing but an empty auths is left", () => {
    const made = withProxies(undefined, MARKERS)
    expect(withoutProxies(made, true)).toBeUndefined()
    expect(withoutProxies('{"auths":{},"proxies":{}}', true)).toBeUndefined()
    expect(JSON.parse(withoutProxies('{"auths":{}}', false)!)).toEqual({
      auths: {},
    })
    expect(JSON.parse(withoutProxies('{"auths":{},"x":1}', true)!)).toEqual({
      auths: {},
      x: 1,
    })
    expect(JSON.parse(withoutProxies('{"auths":[]}', true)!)).toEqual({
      auths: [],
    })
  })
})

describe("the registry's login", () => {
  test("htpasswd holds a bcrypt hash the registry takes, and Bun verifies the password against it", async () => {
    const line = await htpasswdLine(
      "check-0123",
      "0123456789abcdef0123456789abcdef"
    )
    expect(line).toMatch(HTPASSWD_LINE)
    const hash = line.slice("check-0123:".length)
    expect(
      await Bun.password.verify("0123456789abcdef0123456789abcdef", hash)
    ).toBe(true)
    expect(line).not.toContain("0123456789abcdef0123456789abcdef")
  })

  test("refuses a user or password bcrypt would not take whole", async () => {
    await expect(htpasswdLine("a:b", "0123456789abcdef")).rejects.toThrow(
      "a user is"
    )
    await expect(htpasswdLine("a", "short")).rejects.toThrow("16 to 72 bytes")
    await expect(htpasswdLine("a", "x".repeat(73))).rejects.toThrow(
      "16 to 72 bytes"
    )
  })

  test("logs in with the password on standard input, never in an argument", () => {
    expect(loginArgs("check-0123", "127.0.0.1:5000")).toEqual([
      "docker",
      "login",
      "--username",
      "check-0123",
      "--password-stdin",
      "127.0.0.1:5000",
    ])
    expect(() => loginArgs("a b", "127.0.0.1:5000")).toThrow("a user is")
  })
})

describe("the Dockerfile", () => {
  const BASE = `127.0.0.1:5000/check/base@sha256:${"ab".repeat(32)}`
  const TOKEN = "0123456789abcdef0123456789abcdef"

  test("builds from the private base by digest and prints the step's environment between its two lines", () => {
    expect(proxyDockerfile(BASE, TOKEN)).toBe(
      `FROM ${BASE}\nRUN : ${TOKEN} && echo ${ENV_BEGIN} && env && echo ${ENV_END}\n`
    )
  })

  test("refuses a base outside the check's registry or without a digest, and a token that is not the run's", () => {
    for (const base of [
      "127.0.0.1:5000/check/base:1",
      `docker.io/check/base@sha256:${"ab".repeat(32)}`,
      `127.0.0.1:5000/check/base@sha256:${"ab".repeat(31)}`,
      `${BASE}\nRUN x`,
    ])
      expect(() => proxyDockerfile(base, TOKEN)).toThrow(
        "is not a base in the check's registry"
      )
    expect(() => proxyDockerfile(BASE, "x")).toThrow("32 hex")
  })
})

describe("what reached the step", () => {
  test("none: the ten names set empty, no marker", () => {
    const env = [...PROXY_NAMES.map((name) => `${name}=`), "PATH=/bin"]
    const found = proxyFindings(env.join("\n"), env, MARKERS)
    expect(found).toEqual({ markers: [], valued: [], empty: 10 })
    expect(proxyWords(found)).toBe(
      "no marker of config.json reached the step, none of the ten names had a value (10 of the ten set empty)"
    )
  })

  test("a marker anywhere in the output, and a name with a value", () => {
    const env = [
      `http_proxy=${MARKERS.httpProxy}`,
      `NO_PROXY=${MARKERS.noProxy}`,
      "HTTPS_PROXY=",
    ]
    const found = proxyFindings(`${env.join("\n")}\n`, env, MARKERS)
    expect(found).toEqual({
      markers: ["httpProxy", "noProxy"],
      valued: ["NO_PROXY", "http_proxy"],
      empty: 1,
    })
    expect(proxyWords(found)).toBe(
      "the markers of httpProxy, noProxy reached the step, with a value: NO_PROXY, http_proxy (1 of the ten set empty)"
    )
    expect(proxyWords(found)).not.toContain(".invalid")
  })

  test("a line with no = is not a variable; an environment not seen is said", () => {
    expect(proxyFindings("", ["HTTP_PROXY", "=x"], MARKERS)).toEqual({
      markers: [],
      valued: [],
      empty: 0,
    })
    expect(proxyWords(undefined)).toBe("the step's environment was not seen")
  })
})
