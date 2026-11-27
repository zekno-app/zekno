/**
 * `sandbox-probe.ts` (specs/016-build-from-source, T020; check L18): the
 * step each Dockerfile holds (run here once with this machine's own `sh`,
 * with no address to try), the reading of `--progress=rawjson` and of what
 * the step printed, and the judgement of each build. Nothing here runs
 * Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  addressesOf,
  capEffOf,
  type CaseSeen,
  caseWords,
  CONTROL,
  devicePath,
  deviceToTry,
  interfacesOf,
  isFull,
  markerOf,
  type Probe,
  probeDockerfile,
  probeScript,
  reached,
  reachTarget,
  readProbe,
  sandboxCases,
  type StandInSeen,
  stepOutput,
  violations,
} from "./sandbox-probe"

const NONCE = "0123456789abcdef0123456789abcdef"
const MARK = `zekno-l18-${NONCE}`
const BASE = `busybox@sha256:${"7".repeat(64)}`

const NET_DEV = [
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0",
  "  eth0:    1296      12    0    0    0     0          0         0        0       0    0    0    0     0       0          0",
].join("\n")

const IP_BUSYBOX = [
  "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever",
  "2: eth0    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0\\       valid_lft forever preferred_lft forever",
].join("\n")

const IP_STAND_IN = [
  "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever",
  "1: lo    inet6 ::1/128 scope host noprefixroute \\       valid_lft forever preferred_lft forever",
  "2: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever",
  "47: eth0@if48    inet 172.20.0.2/16 brd 172.20.255.255 scope global eth0\\       valid_lft forever preferred_lft forever",
  "47: eth0@if48    inet6 FE80::42:ACFF:FE14:2/64 scope link \\       valid_lft forever preferred_lft forever",
].join("\n")

const DEFAULTS =
  "console\ncore\nfd\nfull\nmqueue\nnull\nptmx\npts\nrandom\nshm\nstderr\nstdin\nstdout\ntty\nurandom\nzero"

/** What the step prints, part by part. */
function printed(parts: {
  net?: string
  ip?: string
  dev?: string
  cap?: string
  ssh?: string
  sockets?: string
  reach?: string
  end?: boolean
}): string {
  return [
    `${MARK} net`,
    parts.net ?? NET_DEV,
    `${MARK} ip`,
    ...(parts.ip === undefined ? [`${MARK} ip-absent`] : [parts.ip]),
    `${MARK} dev`,
    parts.dev ?? DEFAULTS,
    `${MARK} cap`,
    parts.cap ?? "CapEff:\t00000000a80425fb",
    `${MARK} ssh`,
    parts.ssh ?? "SSH_AUTH_SOCK=\nno-socket",
    `${MARK} sockets`,
    parts.sockets ?? "",
    `${MARK} reach`,
    parts.reach ?? "not-tried",
    ...(parts.end === false ? [] : [`${MARK} end`]),
    "",
  ].join("\n")
}

const STAND_IN: StandInSeen = {
  addresses: addressesOf(IP_STAND_IN),
  devices: [...DEFAULTS.split("\n"), "kmsg", "loop0", "fuse"],
  capEff: "000001ffffffffff",
}
const CONTROL_PROBE = readProbe(printed({ ip: IP_BUSYBOX }), NONCE)!

describe("the step", () => {
  test("prints each part after its marker, on one line for RUN's shell form", () => {
    const script = probeScript(NONCE)
    expect(script).not.toContain("\n")
    expect(
      script.startsWith(`p=${MARK}; echo "$p net"; cat /proc/net/dev;`)
    ).toBe(true)
    expect(script).toContain(
      'ls -1 /dev; echo "$p cap"; grep CapEff /proc/self/status'
    )
    expect(script).toContain("find /run/buildkit -type s 2> /dev/null || :")
    expect(script.endsWith('echo not-tried; echo "$p end"')).toBe(true)
    expect(probeScript(NONCE, "172.20.0.2")).toContain(
      "timeout 10 nc -w 3 172.20.0.2 22 < /dev/null 2>&1 | head -n 1 || :"
    )
  })

  test("runs to its end in a POSIX sh and reads back", () => {
    const run = Bun.spawnSync(["sh", "-c", probeScript(NONCE)], {
      stdout: "pipe",
      stderr: "ignore",
    })
    expect(run.exitCode).toBe(0)
    const probe = readProbe(run.stdout.toString(), NONCE)
    expect(probe).toBeDefined()
    expect(probe!.reach).toBe("not-tried")
    expect(probe!.devices.length).toBeGreaterThan(0)
  })

  test("refuses a nonce that is not 32 hex, an address that is not IPv4, a base not by digest, a device name with a path out", () => {
    expect(() => markerOf("x")).toThrow("32 hex")
    expect(() => probeScript(NONCE, "10.0.0.1; reboot")).toThrow("not an IPv4")
    expect(() => probeDockerfile("busybox:1.36.1", CONTROL, NONCE)).toThrow(
      "not an image by digest"
    )
    expect(() => devicePath("../etc")).toThrow()
    expect(devicePath("net/tun")).toBe("/dev/net/tun")
  })

  test("each Dockerfile is the base by digest and one RUN with the case's flags", () => {
    expect(probeDockerfile(BASE, CONTROL, NONCE, "172.20.0.2")).toBe(
      `FROM ${BASE}\nRUN ${probeScript(NONCE, "172.20.0.2")}\n`
    )
    const cases = sandboxCases("kmsg")
    expect(cases.map((item) => [item.key, item.flags, item.network])).toEqual([
      ["host", "--network=host", "default"],
      ["insecure", "--security=insecure", "default"],
      ["device", "--device=/dev/kmsg", "default"],
      ["ssh", "--mount=type=ssh", "default"],
      ["none", "--network=default", "none"],
    ])
    expect(probeDockerfile(BASE, cases[3]!, NONCE, "172.20.0.2")).toBe(
      `FROM ${BASE}\nRUN --mount=type=ssh ${probeScript(NONCE)}\n`
    )
    expect(sandboxCases(undefined).map((item) => item.key)).not.toContain(
      "device"
    )
  })
})

describe("reading what buildx and the step printed", () => {
  test("the step's text, from each rawjson line's logs, in order, across lines", () => {
    const b64 = (text: string) => Buffer.from(text).toString("base64")
    const text = [
      JSON.stringify({
        vertexes: [{ digest: "sha256:1", name: "[2/2] RUN x" }],
      }),
      "not json",
      JSON.stringify({
        logs: [{ vertex: "sha256:1", stream: 1, msg: b64("hello ") }],
      }),
      JSON.stringify({
        logs: [{ vertex: "sha256:1", stream: 1, data: b64("world\n") }],
      }),
      JSON.stringify({ statuses: [] }),
    ].join("\n")
    expect(stepOutput(text)).toBe("hello world\n")
    expect(stepOutput("")).toBe("")
  })

  test("addresses of iproute2's and BusyBox's ip -o addr, interfaces of /proc/net/dev, CapEff", () => {
    expect(addressesOf(IP_STAND_IN)).toEqual([
      { name: "lo", address: "127.0.0.1" },
      { name: "lo", address: "::1" },
      { name: "docker0", address: "172.17.0.1" },
      { name: "eth0", address: "172.20.0.2" },
      { name: "eth0", address: "fe80::42:acff:fe14:2" },
    ])
    expect(interfacesOf(NET_DEV)).toEqual(["lo", "eth0"])
    expect(capEffOf("CapInh:\t0\nCapEff:\t000001ffffffffff\n")).toBe(
      "000001ffffffffff"
    )
    expect(capEffOf("nothing")).toBeUndefined()
    expect(isFull("000001ffffffffff", "000001ffffffffff")).toBe(true)
    expect(isFull("000003ffffffffff", "000001ffffffffff")).toBe(true)
    expect(isFull("00000000a80425fb", "000001ffffffffff")).toBe(false)
    expect(isFull("000001ffffffffff", "0")).toBe(false)
  })

  test("the probe, part by part; nothing when the step did not print to its end", () => {
    expect(
      readProbe(
        `earlier\n${printed({ ip: IP_BUSYBOX, ssh: "SSH_AUTH_SOCK=/run/buildkit/ssh_agent.0\nno-socket", sockets: "/run/buildkit/x.sock", reach: "nc: can't connect to remote host (172.20.0.2): Network is unreachable" })}`,
        NONCE
      )
    ).toEqual({
      interfaces: ["lo", "eth0"],
      addresses: [
        { name: "lo", address: "127.0.0.1" },
        { name: "eth0", address: "10.0.2.15" },
      ],
      devices: DEFAULTS.split("\n"),
      capEff: "00000000a80425fb",
      sshAuthSock: "/run/buildkit/ssh_agent.0",
      sshSocket: false,
      sockets: ["/run/buildkit/x.sock"],
      reach:
        "nc: can't connect to remote host (172.20.0.2): Network is unreachable",
    } satisfies Probe)
    expect(readProbe(printed({}), NONCE)!.addresses).toBeUndefined()
    expect(readProbe(printed({ end: false }), NONCE)).toBeUndefined()
    expect(readProbe(printed({}), "f".repeat(32))).toBeUndefined()
  })

  test("the device to try, the address to reach, and sshd's answer", () => {
    const control = DEFAULTS.split("\n")
    expect(deviceToTry([...control, "loop0", "kmsg"], control)).toBe("kmsg")
    expect(deviceToTry([...control, "sda", "loop0"], control)).toBe("sda")
    expect(deviceToTry(control, control)).toBeUndefined()
    expect(reachTarget(addressesOf(IP_STAND_IN))).toBe("172.20.0.2")
    expect(
      reachTarget([
        { name: "docker0", address: "172.17.0.1" },
        { name: "ens5", address: "10.1.2.3" },
      ])
    ).toBe("10.1.2.3")
    expect(reachTarget([{ name: "lo", address: "127.0.0.1" }])).toBeUndefined()
    expect(reached("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20")).toBe(true)
    expect(reached("nc: can't connect")).toBe(false)
  })
})

describe("the judgement", () => {
  const seen = (
    key: string,
    probe: Probe | undefined,
    network: "default" | "none" = "default"
  ): CaseSeen => ({
    key,
    network,
    built: true,
    probe,
  })

  test("a build that failed is no breach; one that built and stayed in the sandbox neither", () => {
    expect(
      violations(
        {
          key: "host",
          network: "default",
          built: false,
          error: "network.host is not allowed",
        },
        STAND_IN,
        CONTROL_PROBE
      )
    ).toEqual([])
    expect(
      violations(seen("ssh", CONTROL_PROBE), STAND_IN, CONTROL_PROBE)
    ).toEqual([])
  })

  test("names each breach: the stand-in's address, its interfaces where there is no ip, a device, the full set, an agent socket", () => {
    const host = readProbe(
      printed({ ip: IP_STAND_IN, net: `${NET_DEV}\ndocker0: 0 0` }),
      NONCE
    )!
    expect(violations(seen("host", host), STAND_IN, CONTROL_PROBE)).toEqual([
      "host ran with the stand-in's own 172.17.0.1, 172.20.0.2, fe80::42:acff:fe14:2",
    ])
    const noIp = readProbe(
      printed({ net: `${NET_DEV}\n docker0: 0 0` }),
      NONCE
    )!
    expect(violations(seen("host", noIp), STAND_IN, CONTROL_PROBE)).toEqual([
      "host ran with the stand-in's interfaces docker0",
    ])
    const device = readProbe(
      printed({ ip: IP_BUSYBOX, dev: `${DEFAULTS}\nkmsg` }),
      NONCE
    )!
    expect(violations(seen("device", device), STAND_IN, CONTROL_PROBE)).toEqual(
      ["device saw devices beyond a container's: kmsg"]
    )
    const insecure = readProbe(
      printed({ ip: IP_BUSYBOX, cap: "CapEff:\t000001ffffffffff" }),
      NONCE
    )!
    expect(
      violations(seen("insecure", insecure), STAND_IN, CONTROL_PROBE)
    ).toEqual(["insecure ran with the full capability set 000001ffffffffff"])
    const ssh = readProbe(
      printed({
        ip: IP_BUSYBOX,
        ssh: "SSH_AUTH_SOCK=/run/buildkit/ssh_agent.0\nsocket",
        sockets: "/run/buildkit/ssh_agent.0",
      }),
      NONCE
    )!
    expect(violations(seen("ssh", ssh), STAND_IN, CONTROL_PROBE)).toEqual([
      "ssh had an SSH agent socket at /run/buildkit/ssh_agent.0",
      "ssh had sockets under /run/buildkit: /run/buildkit/ssh_agent.0",
    ])
    expect(violations(seen("ssh", undefined), STAND_IN, CONTROL_PROBE)).toEqual(
      ["ssh built, and what its step printed could not be read"]
    )
    const silent = readProbe(printed({ ip: IP_BUSYBOX, cap: "" }), NONCE)!
    expect(violations(seen("x", silent), STAND_IN, CONTROL_PROBE)).toEqual([
      "x printed no CapEff",
    ])
  })

  test("under a signed none: only lo, and no answer from the stand-in's address", () => {
    const shut = readProbe(
      printed({
        ip: "1: lo    inet 127.0.0.1/8 scope host lo",
        net: NET_DEV.split("\n").slice(0, 3).join("\n"),
        reach: "nc: bad address",
      }),
      NONCE
    )!
    expect(
      violations(seen("none", shut, "none"), STAND_IN, CONTROL_PROBE)
    ).toEqual([])
    const open = readProbe(
      printed({ ip: IP_BUSYBOX, reach: "SSH-2.0-OpenSSH_9.6p1" }),
      NONCE
    )!
    expect(
      violations(seen("none", open, "none"), STAND_IN, CONTROL_PROBE)
    ).toEqual([
      "none had network interfaces eth0",
      "none had addresses beyond loopback: eth0 10.0.2.15",
      "none reached the stand-in's sshd: SSH-2.0-OpenSSH_9.6p1",
    ])
  })

  test("under a signed none: the kernel's idle tunnel devices are no network, an address on one is", () => {
    const tunnels = ["tunl0", "gre0", "gretap0", "erspan0", "ip_vti0"]
    const net = [
      ...NET_DEV.split("\n").slice(0, 3),
      ...["ip6_vti0", "sit0", "ip6tnl0", "ip6gre0", ...tunnels].map(
        (name) => `${name}:       0       0    0    0    0     0          0`
      ),
    ].join("\n")
    const idle = readProbe(
      printed({
        ip: "1: lo    inet 127.0.0.1/8 scope host lo",
        net,
        reach: "nc: bad address",
      }),
      NONCE
    )!
    expect(idle.interfaces).toContain("tunl0")
    expect(
      violations(seen("none", idle, "none"), STAND_IN, CONTROL_PROBE)
    ).toEqual([])
    const addressed = readProbe(
      printed({
        ip: "1: lo    inet 127.0.0.1/8 scope host lo\n3: sit0    inet 10.9.9.9/24 scope global sit0",
        net,
        reach: "nc: bad address",
      }),
      NONCE
    )!
    expect(
      violations(seen("none", addressed, "none"), STAND_IN, CONTROL_PROBE)
    ).toEqual(["none had addresses beyond loopback: sit0 10.9.9.9"])
  })

  test("words each case for the record line", () => {
    expect(
      caseWords(
        {
          key: "host",
          network: "default",
          built: false,
          error: "network.host is not allowed",
        },
        CONTROL_PROBE,
        "RUN --network=host"
      )
    ).toBe("RUN --network=host: not built: network.host is not allowed")
    expect(caseWords(seen("ssh", CONTROL_PROBE), CONTROL_PROBE)).toBe(
      "ssh: built, interfaces lo eth0, lo 127.0.0.1, eth0 10.0.2.15, /dev as the control's, CapEff 00000000a80425fb, SSH_AUTH_SOCK=(unset) no socket, sockets under /run/buildkit: none"
    )
    const control = readProbe(
      printed({ ip: IP_BUSYBOX, reach: "SSH-2.0-OpenSSH_9.6p1" }),
      NONCE
    )!
    expect(caseWords(seen("control", control))).toContain(
      "port 22 of the stand-in: answered"
    )
    expect(caseWords(seen("ssh", undefined))).toBe(
      "ssh: built, its step's output not read"
    )
  })
})
