/**
 * `sandbox-run.ts` (specs/016-build-from-source, T020; check L18): the
 * stand-in read first, the control before the cases, each build with RB7's
 * list, the record's words and the breaches, and the removal of what the
 * check made by name, also after a failure. A stand-in function answers for
 * the stand-in as BuildKit would, from the Dockerfile in each pack; nothing
 * here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import type { Answer, RunOptions } from "../host/host-docker"
import { builtName, type InStandIn, neverPassedIn } from "../build-runs/rb7"
import {
  APP,
  cleanUpSandbox,
  HOME,
  labelOf,
  observeSandbox,
  ROOT,
  type SandboxMade,
} from "./sandbox-run"

const BASE = `busybox@sha256:${"7".repeat(64)}`
const DEFAULTS =
  "console\nfd\nfull\nmqueue\nnull\nptmx\npts\nrandom\nshm\nstderr\nstdin\nstdout\ntty\nurandom\nzero"
const IP_STAND_IN =
  "1: lo    inet 127.0.0.1/8 scope host lo\n2: docker0    inet 172.17.0.1/16 scope global docker0\n47: eth0@if48    inet 172.20.0.2/16 scope global eth0\n"

/** How the fake builder treats each step, by its flags. */
type Builder = {
  /** Fails with this error, or runs and prints with `printed`. */
  readonly fails?: (dockerfile: string, network: string) => string | undefined
  readonly printed?: (
    dockerfile: string,
    network: string
  ) => Partial<Record<string, string>>
}

function rawjson(
  nonce: string,
  parts: Partial<Record<string, string>>
): string {
  const mark = `zekno-l18-${nonce}`
  const text = [
    `${mark} net`,
    parts.net ?? "    lo: 0 0\n  eth0: 0 0",
    `${mark} ip`,
    parts.ip ??
      "1: lo    inet 127.0.0.1/8 scope host lo\n2: eth0    inet 10.0.2.15/24 scope global eth0",
    `${mark} dev`,
    parts.dev ?? DEFAULTS,
    `${mark} cap`,
    parts.cap ?? "CapEff:\t00000000a80425fb",
    `${mark} ssh`,
    parts.ssh ?? "SSH_AUTH_SOCK=\nno-socket",
    `${mark} sockets`,
    "",
    `${mark} reach`,
    parts.reach ?? "not-tried",
    `${mark} end`,
    "",
  ].join("\n")
  const half = Math.floor(text.length / 2)
  return [text.slice(0, half), text.slice(half)]
    .map((chunk) =>
      JSON.stringify({
        logs: [
          {
            vertex: "sha256:1",
            stream: 1,
            msg: Buffer.from(chunk).toString("base64"),
          },
        ],
      })
    )
    .join("\n")
}

/** Stands in for `open.inStandIn`, answering builds as `builder` says. */
function fakeStandIn(
  builder: Builder,
  more: (args: readonly string[]) => Partial<Answer> | undefined = () =>
    undefined
) {
  const calls: {
    args: readonly string[]
    options?: RunOptions
    dockerfile?: string
  }[] = []
  const run: InStandIn = async (args, options) => {
    const input = options?.stdin
    const pack =
      input !== undefined && "file" in input
        ? readFileSync(input.file).toString("latin1")
        : undefined
    const dockerfile =
      pack === undefined
        ? undefined
        : /FROM [^\0]*?\n(?:RUN [^\0\n]*\n)?/.exec(pack)?.[0]
    calls.push({ args, options, dockerfile })
    const extra = more(args)
    if (extra !== undefined)
      return { code: 0, stdout: "", stderr: "", ...extra }
    if (args.includes("version"))
      return {
        code: 0,
        stdout: "github.com/docker/buildx v0.34.1 x\n",
        stderr: "",
      }
    if (args[1] === "image" && args[2] === "inspect")
      return { code: 1, stdout: "", stderr: "Error: No such image\n" }
    if (args[0] === "ip") return { code: 0, stdout: IP_STAND_IN, stderr: "" }
    if (args[0] === "ls")
      return { code: 0, stdout: `${DEFAULTS}\nkmsg\nloop0\n`, stderr: "" }
    if (args[0] === "grep")
      return { code: 0, stdout: "CapEff:\t000001ffffffffff\n", stderr: "" }
    if (args[0] === "cat")
      return {
        code: 0,
        stdout: JSON.stringify({
          "buildx.build.ref": `default/default/ref${calls.length}xxxxxxxx`,
        }),
        stderr: "",
      }
    if (dockerfile !== undefined) {
      const network = args[args.indexOf("--network") + 1]!
      const nonce = /zekno-l18-([0-9a-f]{32})/.exec(dockerfile)![1]!
      const error = builder.fails?.(dockerfile, network)
      if (error !== undefined)
        return { code: 1, stdout: "", stderr: `ERROR: ${error}\n` }
      return {
        code: 0,
        stdout: "",
        stderr: rawjson(nonce, builder.printed?.(dockerfile, network) ?? {}),
      }
    }
    return { code: 0, stdout: "", stderr: "" }
  }
  return { run, calls }
}

/** BuildKit as expected: the entitlements and the unknown device refused, the rest sandboxed. */
const SANDBOXED: Builder = {
  fails: (dockerfile) =>
    dockerfile.includes("--network=host")
      ? "failed to solve: network.host is not allowed"
      : dockerfile.includes("--security=insecure")
        ? "failed to solve: security.insecure is not allowed"
        : dockerfile.includes("--device=")
          ? "dockerfile parse error on line 2: unknown flag: device"
          : undefined,
  printed: (dockerfile, network) =>
    network === "none"
      ? {
          net: "    lo: 0 0",
          ip: "1: lo    inet 127.0.0.1/8 scope host lo",
          reach:
            "nc: can't connect to remote host (172.20.0.2): Network is unreachable",
        }
      : dockerfile.includes("--mount=type=ssh")
        ? { ssh: "SSH_AUTH_SOCK=/run/buildkit/ssh_agent.0\nno-socket" }
        : dockerfile.includes("nc -w 3")
          ? { reach: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20" }
          : {},
}

describe("observeSandbox", () => {
  test("reads the stand-in, builds the control then each case with RB7's list, and finds no breach where BuildKit holds", async () => {
    const { run, calls } = fakeStandIn(SANDBOXED)
    const made: SandboxMade = { options: [], results: [] }
    const seen = await observeSandbox(run, made, BASE)
    expect(seen.violations).toEqual([])
    expect(made.options.map((options) => options.key)).toEqual([
      "control",
      "host",
      "insecure",
      "device",
      "ssh",
      "none",
    ])
    expect(made.base).toEqual({ image: BASE, there: false })
    const builds = calls.filter((call) => call.dockerfile !== undefined)
    for (const call of builds) {
      expect(
        neverPassedIn(call.args.slice(call.args.indexOf("docker")))
      ).toEqual([])
      expect(call.args).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
      expect(call.dockerfile!.startsWith(`FROM ${BASE}\nRUN `)).toBe(true)
    }
    expect(
      builds.map((call) => call.args[call.args.indexOf("--network") + 1])
    ).toEqual(["default", "default", "default", "default", "default", "none"])
    expect(builds[3]!.dockerfile).toContain("RUN --device=/dev/kmsg ")
    expect(builds[5]!.dockerfile).toContain("RUN --network=default ")
    expect(builds[5]!.dockerfile).toContain("nc -w 3 172.20.0.2 22")
    expect(seen.words).toContain(
      "RUN --network=host: not built: failed to solve: network.host is not allowed"
    )
    expect(seen.words).toContain("RUN --device=/dev/kmsg: not built:")
    expect(seen.words).toContain(
      "RUN --mount=type=ssh: built, interfaces lo eth0"
    )
    expect(seen.words).toContain(
      "SSH_AUTH_SOCK=/run/buildkit/ssh_agent.0 no socket"
    )
    expect(seen.words).toContain("control: built")
    expect(seen.words).toContain("port 22 of the stand-in: answered")
    expect(seen.words).toContain(
      "--network none with RUN --network=default: built, interfaces lo, lo 127.0.0.1"
    )
    expect(
      seen.words.endsWith("every build failed or stayed in the sandbox")
    ).toBe(true)
  })

  test("names every breach when a step reaches the host network, a device, the full set or an agent", async () => {
    const { run } = fakeStandIn({
      printed: (dockerfile, network) =>
        dockerfile.includes("--network=host")
          ? {
              ip: "2: eth0    inet 172.20.0.2/16 scope global eth0",
              net: "  eth0: 0\n  docker0: 0",
            }
          : dockerfile.includes("--security=insecure")
            ? { cap: "CapEff:\t000001ffffffffff" }
            : dockerfile.includes("--device=")
              ? { dev: `${DEFAULTS}\nkmsg` }
              : dockerfile.includes("--mount=type=ssh")
                ? { ssh: "SSH_AUTH_SOCK=/run/buildkit/ssh_agent.0\nsocket" }
                : network === "none"
                  ? { reach: "SSH-2.0-OpenSSH_9.6p1" }
                  : {},
    })
    const seen = await observeSandbox(run, { options: [], results: [] }, BASE)
    expect(seen.violations).toEqual([
      "host ran with the stand-in's own 172.20.0.2",
      "insecure ran with the full capability set 000001ffffffffff",
      "device saw devices beyond a container's: kmsg",
      "ssh had an SSH agent socket at /run/buildkit/ssh_agent.0",
      "none had network interfaces eth0",
      "none had addresses beyond loopback: eth0 10.0.2.15",
      "none reached the stand-in's sshd: SSH-2.0-OpenSSH_9.6p1",
    ])
    expect(seen.words).toContain("breaches: host ran with")
  })

  test("a control that does not build, or whose step cannot be read, stops the check", async () => {
    const failing = fakeStandIn({
      fails: () => "failed to resolve source metadata",
    })
    const made: SandboxMade = { options: [], results: [] }
    await expect(observeSandbox(failing.run, made, BASE)).rejects.toThrow(
      "L18's control did not build, so no case can be judged: failed to resolve source metadata"
    )
    expect(made.options.map((options) => options.key)).toEqual(["control"])
    const silent = fakeStandIn({}, (args) =>
      args.includes("-") && args.includes("build") ? { stderr: "" } : undefined
    )
    await expect(
      observeSandbox(silent.run, { options: [], results: [] }, BASE)
    ).rejects.toThrow(
      "L18's control built, and what its step printed could not be read"
    )
  })

  test("a stand-in whose capability set cannot be read stops the check before any build", async () => {
    const { run, calls } = fakeStandIn(SANDBOXED, (args) =>
      args[0] === "grep" ? { stdout: "" } : undefined
    )
    await expect(
      observeSandbox(run, { options: [], results: [] }, BASE)
    ).rejects.toThrow("cannot read the stand-in's own capability set")
    expect(calls.some((call) => call.dockerfile !== undefined)).toBe(false)
  })

  test("labels each case by its RUN flag", () => {
    expect(labelOf("host", "kmsg")).toBe("RUN --network=host")
    expect(labelOf("device", "kmsg")).toBe("RUN --device=/dev/kmsg")
    expect(labelOf("none", undefined)).toBe(
      "--network none with RUN --network=default"
    )
    expect(labelOf("other", undefined)).toBe("other")
  })
})

describe("cleanUpSandbox", () => {
  test("removes the images its builds tagged and the base it brought, its records by id and its folder, also after a failure", async () => {
    const failing = fakeStandIn({ fails: () => "no" })
    const made: SandboxMade = { options: [], results: [] }
    await observeSandbox(failing.run, made, BASE).catch(() => {})
    const { run, calls } = fakeStandIn({}, (args) =>
      args[0] === "sh" && args[2]?.startsWith("ls -1")
        ? { stdout: "abcdefghij123\n" }
        : undefined
    )
    const said: string[] = []
    expect(await cleanUpSandbox(run, made, (line) => said.push(line))).toEqual(
      []
    )
    expect(
      calls
        .filter((call) => call.args[1] === "image" && call.args[2] === "rm")
        .map((call) => call.args[3])
    ).toEqual([builtName({ app: APP, key: "control" }), BASE])
    const history = calls.find((call) => call.args.includes("history"))!
    expect(history.args.at(-1)).toBe("abcdefghij123")
    expect(calls.at(-1)!.args).toEqual(["rm", "-rf", ROOT])
    expect(said).toEqual([])
  })

  test("leaves a base that was there before, and says what it could not remove", async () => {
    const made: SandboxMade = {
      options: [
        {
          app: APP,
          key: "host",
          dockerfile: "Dockerfile",
          network: "default",
          work: `${ROOT}/host`,
        },
      ],
      results: [],
      base: { image: BASE, there: true },
    }
    const { run, calls } = fakeStandIn({}, (args) =>
      args[1] === "image" && args[2] === "rm"
        ? { code: 1, stderr: "Error: conflict: unable to remove\n" }
        : args.includes("history")
          ? { code: 1, stderr: "no" }
          : args[0] === "sh"
            ? { stdout: "abcdefghij123\n" }
            : undefined
    )
    const said: string[] = []
    expect(await cleanUpSandbox(run, made, (line) => said.push(line))).toEqual([
      `${builtName({ app: APP, key: "host" })} (conflict: unable to remove)`,
    ])
    expect(
      calls.filter((call) => call.args[2] === "rm").map((call) => call.args[3])
    ).toEqual([builtName({ app: APP, key: "host" })])
    expect(said).toEqual([
      "L18 could not remove its build records abcdefghij123; they go with the stand-in",
    ])
  })
})
