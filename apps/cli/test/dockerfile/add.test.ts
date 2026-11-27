/**
 * `ADD` of a remote source (specs/016-build-from-source, contracts/cli.md
 * CL3, "Refused before signing" and "C13's set, exactly"; FR-042a;
 * quickstart.md US4; tasks T120): a source by a scheme, an SCP-like address
 * or `github.com/…`, read with the plain variables given to the build, as an
 * image name is. C12 with no checksum; C13 for a host in CL3's set, with a
 * checksum or not; C11 for a source zekno cannot resolve that could be
 * remote. Only ids are checked, never words.
 */
import { describe, expect, test } from "bun:test"

import {
  checkAdds,
  isRefusedHost,
  serverAddresses,
} from "../../src/dockerfile/add"
import { readDockerfile } from "../../src/dockerfile/instructions"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"

const SUM = `--checksum=sha256:${"d".repeat(64)}`

/** zekno's server: its name, and the address of its SSH destination. */
const SERVER = serverAddresses({
  name: "prod",
  target: {
    kind: "ssh",
    destination: "deploy@203.0.113.5",
    runnerPath: "~/.zekno/runner",
  },
})

const check = (text: string, given: Record<string, string> = {}) =>
  checkAdds({
    service: "web",
    reading: readDockerfile(new TextEncoder().encode(text), "Dockerfile"),
    given: new Map(Object.entries(given)),
    server: SERVER,
  })

/** The line a stop holds, or null when the Dockerfile passes. */
function stopOf(text: string, given?: Record<string, string>) {
  try {
    check(text, given)
    return null
  } catch (error) {
    if (error instanceof BuildStop) return error.line
    throw error
  }
}

const add = (source: string, checksum = true) =>
  `FROM node:22\nADD ${checksum ? `${SUM} ` : ""}${source} /dest\n`

describe("C12: a remote ADD with no checksum", () => {
  test("a web address", () => {
    expect(stopOf(add("https://example.com/tool.tar.gz", false))).toEqual({
      id: "C12",
      service: "web",
      url: "https://example.com/tool.tar.gz",
      line: 2,
    })
    expect(exitStatusOf("C12")).toBe(1)
  })

  test.each([
    ["any scheme", "git://example.com/repo.git"],
    ["a scheme in capitals", "HTTPS://example.com/tool"],
    ["an SCP-like address", "git@github.com:org/repo.git"],
    ["github.com/…", "github.com/org/repo"],
  ])("%s", (_, source) => {
    expect(stopOf(add(source, false))).toMatchObject({ id: "C12", url: source })
  })

  test("the JSON form with text after it is read as BuildKit reads it: the array, the rest left unread", () => {
    // BuildKit's `parseJSON` decodes the first JSON value with Go's `json.Decoder` and does not look further.
    expect(
      stopOf('FROM node:22\nADD ["https://example.com/x.sh", "/x"] x\n')
    ).toMatchObject({ id: "C12", url: "https://example.com/x.sh", line: 2 })
    expect(
      stopOf(
        'FROM node:22\nADD ["http://169.254.169.254/latest/meta-data/", "/m"] #\n'
      )
    ).toMatchObject({ id: "C13", line: 2 })
  })

  test("in the JSON form, and through a plain variable given to the build", () => {
    expect(
      stopOf('FROM node:22\nADD ["https://example.com/a", "/a"]\n')
    ).toMatchObject({ id: "C12", line: 2 })
    expect(
      stopOf("FROM scratch\nARG URL\nADD $URL /a\n", {
        URL: "https://example.com/a",
      })
    ).toMatchObject({ id: "C12", url: "https://example.com/a", line: 3 })
  })

  test("with a checksum, a public address is fetched as the Dockerfile says", () => {
    expect(stopOf(add("https://example.com/tool.tar.gz"))).toBeNull()
    expect(stopOf(add("http://93.184.216.34/tool.tar.gz"))).toBeNull()
    expect(stopOf(add("git@github.com:org/repo.git"))).toBeNull()
  })

  test("local sources, heredocs and ONBUILD lines are not fetched here", () => {
    expect(stopOf("FROM node:22\nADD app.tar.gz a@b /app/\n")).toBeNull()
    expect(stopOf("FROM node:22\nADD <<EOF /a\nhttp://x\nEOF\n")).toBeNull()
    expect(
      stopOf("FROM node:22\nONBUILD ADD https://example.com/a /a\n")
    ).toBeNull()
  })
})

describe("C13: quickstart.md US4's cases, each with a checksum", () => {
  test.each([
    "http://10.0.0.5/setup.sh",
    "http://[::ffff:127.0.0.1]/setup.sh",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.100.100.200/latest/meta-data/",
    "http://0177.0.0.1/setup.sh",
    "http://localhost./setup.sh",
  ])("%s", (url) => {
    expect(stopOf(add(url))).toEqual({
      id: "C13",
      service: "web",
      url,
      line: 2,
    })
  })

  test("C13 before C12: with no checksum it is still C13", () => {
    expect(stopOf(add("http://10.0.0.5/setup.sh", false))).toMatchObject({
      id: "C13",
    })
    expect(exitStatusOf("C13")).toBe(1)
  })

  test("an SCP-like address of a private host, and one through a plain variable", () => {
    expect(stopOf(add("git@10.0.0.5:org/repo.git"))).toMatchObject({
      id: "C13",
    })
    expect(
      stopOf(`FROM scratch\nARG URL\nADD ${SUM} \${URL} /a\n`, {
        URL: "http://192.168.1.10/a",
      })
    ).toMatchObject({ id: "C13", url: "http://192.168.1.10/a" })
  })
})

describe("C11: a source that cannot be resolved and could be remote", () => {
  test("a variable a base image might define", () => {
    expect(
      stopOf("FROM node:22\nARG URL=https://example.com/a\nADD ${URL} /a\n")
    ).toEqual({
      id: "C11",
      service: "web",
      instruction: "ADD ${URL}",
      line: 3,
      variable: "URL",
    })
  })

  test("a source that starts as a local path is local, whatever its variables", () => {
    expect(stopOf("FROM node:22\nARG F\nADD ./${F} /a\n")).toBeNull()
    expect(stopOf("FROM node:22\nADD /files/$F ../x$F /a/\n")).toBeNull()
    expect(stopOf("FROM node:22\nADD src/${F}.tar /a/\n")).toBeNull()
  })

  test("a byte order mark before a source is dropped, as BuildKit's lexer drops it", () => {
    expect(
      stopOf(`FROM node:22\nADD ${SUM} a.txt \ufeffhttp://10.0.0.5/a /a/\n`)
    ).toMatchObject({ id: "C13", url: "http://10.0.0.5/a" })
    expect(
      stopOf(`FROM node:22\nADD ${SUM} a.txt \ufeffhttp://10.0.0.5/$F /a/\n`)
    ).toMatchObject({ id: "C11", variable: "F" })
  })

  test("a literal start that could still become remote is not enough", () => {
    for (const source of ["http${S}://x/a", "git@${HOST}:r", "github.com/${R}"])
      expect(stopOf(`FROM node:22\nADD ${SUM} ${source} /a\n`)).toMatchObject({
        id: "C11",
      })
  })
})

describe("C13's set, exactly", () => {
  const refused = (host: string) => isRefusedHost(host, SERVER)

  test("one pair of brackets and one trailing dot removed; localhost and .localhost", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "localhost.",
      "api.localhost",
      "[::1]",
      "[::]",
    ])
      expect([host, refused(host)]).toEqual([host, true])
    expect(refused("localhost..")).toBe(false)
  })

  test("a single label, and the server's own name or address", () => {
    for (const host of [
      "intranet",
      "prod",
      "203.0.113.5",
      "[::ffff:203.0.113.5]",
    ])
      expect([host, refused(host)]).toEqual([host, true])
    expect(isRefusedHost("deploy.example.com.", ["deploy.example.com"])).toBe(
      true
    )
  })

  test("each IPv4 range, at its edges", () => {
    for (const host of [
      "0.0.0.0",
      "0.255.255.255",
      "127.0.0.1",
      "10.255.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.0",
      "100.127.255.255",
    ])
      expect([host, refused(host)]).toEqual([host, true])
    for (const host of [
      "1.0.0.0",
      "126.255.255.255",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "100.63.255.255",
      "100.128.0.0",
      "8.8.8.8",
    ])
      expect([host, refused(host)]).toEqual([host, false])
  })

  test("each IPv6 range, and the IPv4-mapped and IPv4-compatible forms", () => {
    for (const host of [
      "[::]",
      "[::1]",
      "[0:0:0:0:0:0:0:1]",
      "[fc00::1]",
      "[fdff:ffff::1]",
      "[fe80::1]",
      "[febf::1]",
      "[fe80::1%25eth0]",
      "[::ffff:10.0.0.1]",
      "[::ffff:a00:1]",
      "[::10.0.0.1]",
      "[::ffff:169.254.169.254]",
    ])
      expect([host, refused(host)]).toEqual([host, true])
    for (const host of [
      "[2001:4860:4860::8888]",
      "[fbff::1]",
      "[fec0::1]",
      "[::ffff:8.8.8.8]",
      "[64:ff9b::808:808]",
    ])
      expect([host, refused(host)]).toEqual([host, false])
  })

  test("numeric labels that are not a plain dotted-decimal address with no leading zero", () => {
    for (const host of [
      "0177.0.0.1",
      "0x7f.1",
      "0X7F.0.0.1",
      "127.1",
      "2130706433",
      "8.8.8.08",
      "256.1.1.1",
      "1.2.3.4.5",
    ])
      expect([host, refused(host)]).toEqual([host, true])
    expect(refused("1.2.3.example")).toBe(false)
  })

  test("a host as a resolver reads it: full-width forms and escapes", () => {
    expect(refused("ｌｏｃａｌｈｏｓｔ")).toBe(true)
    expect(refused("１２７。０。０。１")).toBe(true)
  })

  test("a public name is fetched", () => {
    expect(refused("example.com")).toBe(false)
    expect(refused("registry.npmjs.org.")).toBe(false)
  })
})

describe("the host of an address, as the fetchers read it", () => {
  test.each([
    ["a user and a port", "http://user:pw@10.0.0.5:8080/a"],
    ["a query and a fragment", "http://10.0.0.5?x=/@8.8.8.8#/"],
    ["a backslash before an @", "http://example.com\\\\@10.0.0.5/a"],
    ["a backslash read as a slash", "http://10.0.0.5\\\\@example.com/a"],
    ["a percent escape", "http://%31%30.0.0.5/a"],
    ["an ssh address", "ssh://git@[fe80::1]:22/repo.git"],
  ])("%s", (_, url) => {
    expect(stopOf(add(url))).toMatchObject({ id: "C13" })
  })

  test("an empty host is a single label", () => {
    expect(stopOf(add("http:///etc/passwd"))).toMatchObject({ id: "C13" })
  })
})

describe("the server as zekno knows it", () => {
  test("its name, and the host of its SSH destination", () => {
    expect(SERVER).toEqual(["prod", "203.0.113.5"])
    expect(
      serverAddresses({
        name: "local",
        target: { kind: "local", home: "/tmp/runner" },
      })
    ).toEqual(["local"])
  })
})
