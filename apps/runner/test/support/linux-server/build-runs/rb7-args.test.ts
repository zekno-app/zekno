/**
 * `rb7-args.ts` (specs/016-build-from-source, T011; contracts/runner.md,
 * RB7), branch by branch: the argument list in the contract's order for
 * every combination of network, fresh, syntax, args, secrets, salt and
 * policy; what RB7 never passes; the environment exactly; a secret's value
 * read in the stand-in from a file, never put in an argument (its script
 * is run here with this machine's `sh`). Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  builtName,
  checkFolder,
  neverPassedIn,
  newRunToken,
  PROXY_NAMES,
  rb7Args,
  rb7Command,
  rb7Env,
  type Rb7Options,
  withExtra,
} from "./rb7-args"

const WORK = "/tmp/zekno-check-x/k1"
const HOME = "/tmp/zekno-check-x/home"
const TOKEN = "0123456789abcdef0123456789abcdef"
const SALT = "fedcba9876543210fedcba9876543210"
const BASE: Rb7Options = {
  app: "web",
  key: "k1",
  dockerfile: "Dockerfile",
  network: "default",
  work: WORK,
}
const PROXIES = PROXY_NAMES.flatMap((name) => ["--build-arg", `${name}=`])
const TAIL = [
  ...["--provenance=false", "--sbom=false"],
  ...["--tag", "zekno.invalid/web:k1"],
  ...["--metadata-file", `${WORK}/meta.json`],
  "--progress=rawjson",
  "-",
]

describe("RB7's argument list", () => {
  test("is the contract's, in its order, for the least a build signs", () => {
    expect(rb7Args(BASE)).toEqual([
      ...["docker", "buildx", "build"],
      ...["--builder", "default"],
      ...["--file", "Dockerfile"],
      ...["--network", "default"],
      ...["--build-arg", "BUILDKIT_CACHE_MOUNT_NS=zekno-web"],
      ...PROXIES,
      ...TAIL,
    ])
    expect(PROXIES).toEqual([
      ...["--build-arg", "HTTP_PROXY=", "--build-arg", "HTTPS_PROXY="],
      ...["--build-arg", "FTP_PROXY=", "--build-arg", "NO_PROXY="],
      ...["--build-arg", "ALL_PROXY=", "--build-arg", "http_proxy="],
      ...["--build-arg", "https_proxy=", "--build-arg", "ftp_proxy="],
      ...["--build-arg", "no_proxy=", "--build-arg", "all_proxy="],
    ])
    expect(builtName(BASE)).toBe("zekno.invalid/web:k1")
  })

  test("holds every part at its place when all are given", () => {
    expect(
      rb7Args({
        ...BASE,
        builder: "srv",
        dockerfile: "app/Dockerfile.web",
        target: "run",
        network: "none",
        args: [
          ["NODE_ENV", "production"],
          ["EMPTY", ""],
        ],
        secrets: ["NPM_TOKEN", "GH_TOKEN"],
        salt: SALT,
        fresh: true,
        policyReset: true,
        sourcePolicy: ["--policy", "filename=/tmp/zekno-check-x/deny.rego"],
      })
    ).toEqual([
      ...["docker", "buildx", "build"],
      ...["--builder", "srv"],
      ...["--file", "app/Dockerfile.web"],
      ...["--target", "run"],
      ...["--network", "none"],
      ...["--build-arg", "BUILDKIT_CACHE_MOUNT_NS=zekno-web"],
      ...PROXIES,
      ...["--build-arg", "NODE_ENV=production", "--build-arg", "EMPTY="],
      ...["--secret", "id=NPM_TOKEN,env=ZEKNO_BUILD_SECRET_0"],
      ...["--secret", "id=GH_TOKEN,env=ZEKNO_BUILD_SECRET_1"],
      ...["--add-host", `zekno-${SALT}:127.0.0.1`],
      ...["--no-cache", "--pull"],
      ...["--policy", "reset=true"],
      ...["--policy", "filename=/tmp/zekno-check-x/deny.rego"],
      ...TAIL,
    ])
    expect(rb7Args({ ...BASE, syntax: true })).toEqual([
      ...["docker", "buildx", "build", "--builder", "default"],
      ...["--file", "Dockerfile", "--network", "default"],
      ...["--build-arg", "BUILDKIT_CACHE_MOUNT_NS=zekno-web"],
      ...["--build-arg", "BUILDKIT_SYNTAX=dockerfile.v0"],
      ...PROXIES,
      ...TAIL,
    ])
  })

  test("never holds what RB7 never passes, in any combination", () => {
    let count = 0
    for (const network of ["default", "none"] as const)
      for (const fresh of [false, true])
        for (const syntax of [false, true])
          for (const args of [[], [["A", "1"] as const]])
            for (const secrets of [[], ["NPM_TOKEN"]])
              for (const salt of [undefined, SALT])
                for (const policyReset of [false, true]) {
                  if (syntax && secrets.length > 0) continue
                  const list = rb7Args({
                    ...BASE,
                    ...{ network, fresh, syntax, args, secrets, salt },
                    policyReset,
                  })
                  expect(neverPassedIn(list)).toEqual([])
                  expect(list.slice(-TAIL.length)).toEqual(TAIL)
                  expect(list).not.toContain("host")
                  count++
                }
    expect(count).toBe(96)
  })

  test("refuses what the contract does not allow", () => {
    const refused: [Record<string, unknown>, string][] = [
      [{ network: "host" }, 'never "host"'],
      [{ syntax: true, secrets: ["NPM_TOKEN"] }, "never passed with secrets"],
      [{ dockerfile: "/etc/Dockerfile" }, "the Dockerfile's path"],
      [{ dockerfile: "../Dockerfile" }, "the Dockerfile's path"],
      [{ dockerfile: "a/../Dockerfile" }, "the Dockerfile's path"],
      [{ dockerfile: "-" }, "the Dockerfile's path"],
      [{ target: "--push" }, "the target"],
      [{ app: "Web" }, "the app"],
      [{ key: "a:b" }, "the key"],
      [{ builder: "--push" }, "the builder"],
      [{ args: [["BUILDKIT_SYNTAX", "x"]] }, "not a variable a deploy signs"],
      [{ args: [["Http_Proxy", "x"]] }, "not a variable a deploy signs"],
      [{ args: [["1A", "x"]] }, "the variable"],
      [{ args: [["A", "a\0b"]] }, "holds a NUL"],
      [{ secrets: ["A", "A"] }, "named twice"],
      [{ secrets: ["A-B"] }, "the secret"],
      [{ salt: "abc" }, "the salt"],
      [{ work: "/var/lib/docker" }, "not a folder under /tmp/zekno-check-*"],
      [{ work: "/tmp/zekno-check-x/../y" }, "not a folder under"],
      [{ sourcePolicy: ["--output", "type=local"] }, "never passes --output"],
      [{ sourcePolicy: ["--ssh", "default"] }, "never passes --ssh"],
    ]
    for (const [more, message] of refused)
      expect(() => rb7Args({ ...BASE, ...more } as Rb7Options)).toThrow(message)
  })
})

describe("what RB7 never passes", () => {
  test("is found in any of its forms", () => {
    const found = (...args: string[]) =>
      neverPassedIn([...args, "--tag", "zekno.invalid/web:k1", "-"])
    for (const flag of [
      "--allow",
      "--ssh",
      "--build-context",
      "--output",
      "-o",
      "--load",
      "--push",
      "--attest",
      "--cgroup-parent",
      "--security-opt",
    ])
      expect(found(flag, "x")).toEqual([flag])
    expect(found("--output=type=local")).toEqual(["--output=type=local"])
    expect(found("-otype=local")).toEqual(["-otype=local"])
    expect(found("--network", "host")).toEqual(["--network host"])
    expect(found("--network=host")).toEqual(["--network host"])
    expect(found("--secret", "id=A,src=/etc/passwd")).toEqual([
      "--secret id=A,src=/etc/passwd",
    ])
    expect(found("--file", "/etc/Dockerfile")).toEqual([
      "--file /etc/Dockerfile",
    ])
    expect(found("--file", "a/../../Dockerfile")).toEqual([
      "--file a/../../Dockerfile",
    ])
    expect(found("--build-arg", "BUILDKIT_SYNTAX=docker/dockerfile:1")).toEqual(
      ["--build-arg BUILDKIT_SYNTAX=docker/dockerfile:1"]
    )
    expect(found("--build-arg", "BUILDKIT_SYNTAX=dockerfile.v0")).toEqual([])
    expect(found("--secret", "id=A,env=ZEKNO_BUILD_SECRET_0")).toEqual([])
    expect(neverPassedIn(["docker", "buildx", "build", "."])).toEqual([
      "a context other than -",
    ])
  })

  test("is refused when a check adds it; another flag goes before the final -", () => {
    const list = rb7Args(BASE)
    expect(withExtra(list, ["--iidfile", `${WORK}/iid`])).toEqual([
      ...list.slice(0, -1),
      ...["--iidfile", `${WORK}/iid`, "-"],
    ])
    expect(() => withExtra(list, ["--push"])).toThrow("never passes --push")
    expect(() => withExtra(["docker", "build", "."], [])).toThrow(
      "does not end with -"
    )
  })
})

describe("RB7's environment", () => {
  test("is dockerEnv's names, buildx's folder and switches, and the run token; the secrets come from files", () => {
    expect(rb7Env({ home: HOME, run: TOKEN })).toEqual({
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: "/root",
      BUILDX_CONFIG: `${HOME}/buildx`,
      BUILDX_GIT_INFO: "0",
      BUILDX_GIT_LABELS: "0",
      ZEKNO_BUILD_RUN: TOKEN,
    })
    expect(
      rb7Env({ home: HOME, run: TOKEN, docker: { PATH: "/bin" } })
    ).toEqual({
      PATH: "/bin",
      BUILDX_CONFIG: `${HOME}/buildx`,
      BUILDX_GIT_INFO: "0",
      BUILDX_GIT_LABELS: "0",
      ZEKNO_BUILD_RUN: TOKEN,
    })
    expect(newRunToken()).toMatch(/^[0-9a-f]{32}$/)
    expect(newRunToken()).not.toBe(newRunToken())
    expect(() =>
      rb7Env({ home: HOME, run: TOKEN, docker: { NPM_TOKEN: "x" } })
    ).toThrow("not one of dockerEnv()'s names")
    expect(() => rb7Env({ home: HOME, run: "abc" })).toThrow("the run token")
    expect(() => rb7Env({ home: "/root", run: TOKEN })).toThrow(
      "the home folder"
    )
  })

  test("is given whole with env -i, in the work folder, under a time limit when asked", () => {
    const env = { PATH: "/bin", ZEKNO_BUILD_RUN: TOKEN }
    expect(
      rb7Command(["docker", "buildx", "version"], env, {
        work: WORK,
        timeoutSeconds: 300,
      })
    ).toEqual([
      ...["timeout", "-k", "5", "300", "env", "-i", `--chdir=${WORK}`],
      ...["PATH=/bin", `ZEKNO_BUILD_RUN=${TOKEN}`],
      ...["docker", "buildx", "version"],
    ])
    expect(rb7Command(["true"], { A: "x=y" })).toEqual([
      ...["env", "-i", "A=x=y", "true"],
    ])
    expect(() => rb7Command([], env)).toThrow("needs a command")
    expect(() => rb7Command(["true"], { "A=B": "x" })).toThrow("the variable")
    expect(() => rb7Command(["true"], { A: "\0" })).toThrow("holds a NUL")
    expect(() => rb7Command(["true"], env, { timeoutSeconds: 1.5 })).toThrow(
      "whole number of seconds"
    )
    expect(() => rb7Command(["true"], env, { work: "/" })).toThrow(
      "the work folder"
    )
    expect(() =>
      rb7Command(["true"], { ...env, ZEKNO_BUILD_SECRET_0: "marker" })
    ).toThrow(
      "ZEKNO_BUILD_SECRET_0 is a secret's value: it travels in a file of the stand-in (secretFiles), never in an argument"
    )
    expect(() =>
      rb7Command(["true"], env, { secretFiles: ["/etc/shadow"] })
    ).toThrow("a secret's file")
    expect(checkFolder("/tmp/zekno-check-a/b.c/d")).toBe(
      "/tmp/zekno-check-a/b.c/d"
    )
    for (const path of ["/tmp", "/tmp/zekno-check-", "/tmp/zekno-check-a/./b"])
      expect(() => checkFolder(path)).toThrow("not a folder under")
  })
})

describe("a secret's value", () => {
  const FILES = [`${WORK}/zekno-secret-0`, `${WORK}/zekno-secret-1`]

  test("is read in the stand-in from its file, by a script that holds no value, and the plain list follows it", () => {
    const env = { PATH: "/bin", ZEKNO_BUILD_RUN: TOKEN }
    const list = rb7Command(["docker", "buildx", "version"], env, {
      work: WORK,
      timeoutSeconds: 300,
      secretFiles: FILES,
    })
    expect(list.slice(0, 2)).toEqual(["sh", "-c"])
    expect(list.slice(3)).toEqual(["sh", ...FILES])
    expect(list[2]!.split("\n")).toEqual([
      "set -eu",
      's0=$(cat -- "${1}" && printf x); s0=${s0%x}; rm -f -- "${1}"',
      's1=$(cat -- "${2}" && printf x); s1=${s1%x}; rm -f -- "${2}"',
      `exec 'timeout' '-k' '5' '300' 'env' '-i' '--chdir=${WORK}' 'PATH=/bin' 'ZEKNO_BUILD_RUN=${TOKEN}' "ZEKNO_BUILD_SECRET_0=$s0" "ZEKNO_BUILD_SECRET_1=$s1" 'docker' 'buildx' 'version'`,
    ])
  })

  test("reaches the command whole, as its only addition to the environment, and its file is gone: run here with sh", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-rb7-secret-"))
    try {
      const value = `it's a "secret" $(touch ${folder}/ran) \`x\`\nand a line\n`
      const file = join(folder, "secret")
      writeFileSync(file, value)
      const list = rb7Command(
        ["/usr/bin/env"],
        { PATH: "/usr/bin:/bin" },
        {
          secretFiles: [`${WORK}/zekno-secret-0`],
        }
      )
      expect(list.join(" ")).not.toContain('secret"')
      const ran = Bun.spawnSync([...list.slice(0, 4), file], {
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(ran.exitCode).toBe(0)
      expect(ran.stdout.toString()).toBe(
        `PATH=/usr/bin:/bin\nZEKNO_BUILD_SECRET_0=${value}\n`
      )
      expect(existsSync(file)).toBe(false)
      expect(existsSync(join(folder, "ran"))).toBe(false)
      // A file that cannot be read stops it before the command runs.
      const missing = Bun.spawnSync([...list.slice(0, 4), file], {
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(missing.exitCode).not.toBe(0)
      expect(missing.stdout.toString()).toBe("")
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
