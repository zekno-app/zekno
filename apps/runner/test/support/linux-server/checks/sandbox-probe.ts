/**
 * The probe of check L18 (specs/016-build-from-source, T020; FR-033,
 * SC-008; quickstart.md phase 0, item 3; contracts/runner.md RB7, "Never
 * passed"): the one `RUN` step each of its Dockerfiles holds, what it
 * prints, the reading of that from buildx's `--progress=rawjson`, and the
 * judgement. Pure; `sandbox-run.ts` runs the builds in the stand-in.
 *
 * The step prints, each part after a line `zekno-l18-<nonce> <part>`:
 * `/proc/net/dev`, `ip -o addr` where present, `ls /dev`, `CapEff` from
 * `/proc/self/status`, `SSH_AUTH_SOCK` and whether it names a socket, any
 * socket under `/run/buildkit`, and, where asked, the first line `nc` got
 * from an address of the stand-in's network on port 22 (its sshd). The
 * nonce makes each run's step new to the cache, so it always runs and
 * prints.
 */

/** A case: its key (the build key and the record's word) and its `RUN` flags. */
export type SandboxCase = {
  readonly key: string
  readonly flags: string
  /** The build's `--network`, as RB7 signs it. */
  readonly network: "default" | "none"
  /** Whether the step tries the stand-in's address. */
  readonly reach: boolean
}

/** The control: a plain step under `--network default`, which must build. */
export const CONTROL: SandboxCase = {
  key: "control",
  flags: "",
  network: "default",
  reach: true,
}

/** The cases of quickstart.md's item 3; `device` takes the device `deviceToTry` names. */
export function sandboxCases(device: string | undefined): SandboxCase[] {
  return [
    { key: "host", flags: "--network=host", network: "default", reach: false },
    {
      key: "insecure",
      flags: "--security=insecure",
      network: "default",
      reach: false,
    },
    ...(device === undefined
      ? []
      : [
          {
            key: "device",
            flags: `--device=${devicePath(device)}`,
            network: "default" as const,
            reach: false,
          },
        ]),
    { key: "ssh", flags: "--mount=type=ssh", network: "default", reach: false },
    { key: "none", flags: "--network=default", network: "none", reach: true },
  ]
}

const NONCE = /^[0-9a-f]{32}$/
const DEVICE = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/
const IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** `/dev/<name>`, for a name `ls /dev` printed. */
export function devicePath(name: string): string {
  if (!DEVICE.test(name))
    throw new Error(`${JSON.stringify(name)} is not a device name`)
  return `/dev/${name}`
}

/** The marker before each part of what the step prints. */
export const markerOf = (nonce: string): string => {
  if (!NONCE.test(nonce)) throw new Error("the nonce is 32 hex")
  return `zekno-l18-${nonce}`
}

/** The step's `sh` text, on one line for the `RUN` shell form. */
export function probeScript(nonce: string, reach?: string): string {
  const marker = markerOf(nonce)
  if (reach !== undefined && !IPV4.test(reach))
    throw new Error(`${JSON.stringify(reach)} is not an IPv4 address`)
  const part = (name: string) => `echo "$p ${name}"`
  return [
    `p=${marker}`,
    part("net"),
    "cat /proc/net/dev",
    part("ip"),
    `if command -v ip > /dev/null 2>&1; then ip -o addr 2>&1 || :; else ${part("ip-absent")}; fi`,
    part("dev"),
    "ls -1 /dev",
    part("cap"),
    "grep CapEff /proc/self/status",
    part("ssh"),
    'echo "SSH_AUTH_SOCK=${SSH_AUTH_SOCK:-}"',
    'if [ -n "${SSH_AUTH_SOCK:-}" ] && [ -S "$SSH_AUTH_SOCK" ]; then echo socket; else echo no-socket; fi',
    part("sockets"),
    "find /run/buildkit -type s 2> /dev/null || :",
    part("reach"),
    reach === undefined
      ? "echo not-tried"
      : `timeout 10 nc -w 3 ${reach} 22 < /dev/null 2>&1 | head -n 1 || :`,
    part("end"),
  ].join("; ")
}

/** A Dockerfile of one case: the base, by digest, and the step with its flags. */
export function probeDockerfile(
  base: string,
  sandboxCase: SandboxCase,
  nonce: string,
  reach?: string
): string {
  if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[0-9a-f]{64}$/.test(base))
    throw new Error(`${JSON.stringify(base)} is not an image by digest`)
  const flags = sandboxCase.flags === "" ? "" : `${sandboxCase.flags} `
  const script = probeScript(nonce, sandboxCase.reach ? reach : undefined)
  return `FROM ${base}\nRUN ${flags}${script}\n`
}

/**
 * The text the build's steps printed, from `--progress=rawjson`: each
 * line's `logs`, their `msg` (or `data`) in base64, in order.
 */
export function stepOutput(text: string): string {
  let out = ""
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("{")) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const record = (parsed ?? {}) as Record<string, unknown>
    const logs = record.logs ?? record.Logs
    if (!Array.isArray(logs)) continue
    for (const log of logs as Record<string, unknown>[]) {
      const data = log?.msg ?? log?.data ?? log?.Data
      if (typeof data === "string")
        out += Buffer.from(data, "base64").toString("utf8")
    }
  }
  return out
}

export type Address = { readonly name: string; readonly address: string }

/** The addresses of `ip -o addr`, iproute2's or BusyBox's, with their interface. */
export function addressesOf(text: string): Address[] {
  const found: Address[] = []
  for (const line of text.split("\n")) {
    const match =
      /^\d+:\s+([^\s@]+)(?:@\S+)?\s+inet6?\s+([0-9A-Fa-f.:]+)\//.exec(
        line.trim()
      )
    if (match) found.push({ name: match[1]!, address: match[2]!.toLowerCase() })
  }
  return found
}

/** 127.0.0.0/8 and ::1, which every network namespace holds on its own `lo`. */
export const isLoopback = (address: string): boolean =>
  /^127\./.test(address) || address === "::1"

/** The interfaces `/proc/net/dev` lists. */
export function interfacesOf(text: string): string[] {
  const names: string[] = []
  for (const line of text.split("\n")) {
    const match = /^\s*([^\s:|]+):/.exec(line)
    if (match) names.push(match[1]!)
  }
  return names
}

/** The hex of `CapEff:` in `/proc/self/status`. */
export function capEffOf(text: string): string | undefined {
  return /^CapEff:\s*([0-9a-f]+)\s*$/m.exec(text)?.[1]
}

/** Whether `capEff` holds every capability `full` holds (the privileged stand-in's own set). */
export function isFull(capEff: string, full: string): boolean {
  const all = BigInt(`0x${full}`)
  return all !== 0n && (BigInt(`0x${capEff}`) & all) === all
}

export type Probe = {
  readonly interfaces: readonly string[]
  /** Undefined where the step had no `ip`. */
  readonly addresses: readonly Address[] | undefined
  readonly devices: readonly string[]
  readonly capEff: string | undefined
  readonly sshAuthSock: string
  readonly sshSocket: boolean
  readonly sockets: readonly string[]
  /** The first line `nc` got, `not-tried`, or empty. */
  readonly reach: string
}

/** What the step printed, part by part; undefined when it did not print to its end. */
export function readProbe(output: string, nonce: string): Probe | undefined {
  const marker = `${markerOf(nonce)} `
  const parts = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of output.split("\n")) {
    if (line.startsWith(marker)) {
      current = []
      parts.set(line.slice(marker.length).trim(), current)
    } else current?.push(line)
  }
  if (!parts.has("end")) return undefined
  const text = (name: string) => (parts.get(name) ?? []).join("\n")
  const lines = (name: string) =>
    (parts.get(name) ?? []).map((line) => line.trim()).filter(Boolean)
  const ssh = lines("ssh")
  return {
    interfaces: interfacesOf(text("net")),
    addresses: parts.has("ip-absent") ? undefined : addressesOf(text("ip")),
    devices: lines("dev"),
    capEff: capEffOf(text("cap")),
    sshAuthSock: ssh[0]?.replace(/^SSH_AUTH_SOCK=/, "") ?? "",
    sshSocket: ssh[1] === "socket",
    sockets: lines("sockets"),
    reach: lines("reach")[0] ?? "",
  }
}

/** The devices a probe would show beyond a container's own, first. */
const PREFERRED = ["kmsg", "fuse", "loop-control", "mem", "kvm", "net"]

/**
 * A device of the stand-in that a container does not get: one of
 * `PREFERRED` in that order, else the first the stand-in lists that the
 * control's step did not see; undefined when there is none.
 */
export function deviceToTry(
  standIn: readonly string[],
  control: readonly string[]
): string | undefined {
  const beyond = standIn.filter(
    (name) => !control.includes(name) && DEVICE.test(name)
  )
  return PREFERRED.find((name) => beyond.includes(name)) ?? beyond[0]
}

/** The stand-in's address on its own network: `eth0`'s IPv4, else any IPv4 not on loopback or Docker's bridge. */
export function reachTarget(addresses: readonly Address[]): string | undefined {
  const ipv4 = addresses.filter(
    (item) => IPV4.test(item.address) && !isLoopback(item.address)
  )
  return (
    ipv4.find((item) => item.name === "eth0")?.address ??
    ipv4.find((item) => item.name !== "docker0" && !item.name.startsWith("br-"))
      ?.address
  )
}

/** Whether `nc` read sshd's first line. */
export const reached = (line: string): boolean => line.startsWith("SSH-")

/** What the stand-in itself showed, read with its own `ip`, `ls` and `grep`. */
export type StandInSeen = {
  readonly addresses: readonly Address[]
  readonly devices: readonly string[]
  readonly capEff: string
}

/** One case's build: whether it built, its first error, and the probe when its step printed. */
export type CaseSeen = {
  readonly key: string
  readonly network: "default" | "none"
  readonly built: boolean
  readonly error?: string
  readonly probe?: Probe
}

/**
 * The devices Linux puts in every network namespace once a tunnel module is
 * loaded (as in Docker Desktop's kernel): each is down and carries no
 * address until one is given, so a namespace with no network still lists
 * them in `/proc/net/dev`.
 */
const FALLBACK_TUNNELS = new Set([
  "tunl0",
  "gre0",
  "gretap0",
  "erspan0",
  "ip_vti0",
  "ip6_vti0",
  "sit0",
  "ip6tnl0",
  "ip6gre0",
])

/**
 * Where a build broke the sandbox (FR-033): none when it failed; else its
 * step must have printed to its end, with none of the stand-in's own
 * addresses (beyond loopback), no device the control's step did not see,
 * not the stand-in's full capability set, and no SSH agent socket. Under a
 * signed `none`, also no interface but `lo` and the kernel's own tunnel
 * devices, no address beyond loopback, and no answer from the stand-in's
 * address.
 */
export function violations(
  seen: CaseSeen,
  standIn: StandInSeen,
  control: Probe
): string[] {
  if (!seen.built) return []
  const { key, probe } = seen
  if (probe === undefined)
    return [`${key} built, and what its step printed could not be read`]
  const found: string[] = []
  const own = new Set(
    standIn.addresses
      .map((item) => item.address)
      .filter((address) => !isLoopback(address))
  )
  if (probe.addresses !== undefined) {
    const shared = probe.addresses
      .map((item) => item.address)
      .filter((address) => own.has(address))
    if (shared.length > 0)
      found.push(`${key} ran with the stand-in's own ${shared.join(", ")}`)
  } else {
    const names = new Set(standIn.addresses.map((item) => item.name))
    const extra = probe.interfaces.filter(
      (name) => names.has(name) && name !== "lo" && name !== "eth0"
    )
    if (extra.length > 0)
      found.push(
        `${key} ran with the stand-in's interfaces ${extra.join(", ")}`
      )
  }
  const devices = probe.devices.filter(
    (name) => !control.devices.includes(name)
  )
  if (devices.length > 0)
    found.push(`${key} saw devices beyond a container's: ${devices.join(", ")}`)
  if (probe.capEff === undefined) found.push(`${key} printed no CapEff`)
  else if (isFull(probe.capEff, standIn.capEff))
    found.push(`${key} ran with the full capability set ${probe.capEff}`)
  if (probe.sshSocket)
    found.push(`${key} had an SSH agent socket at ${probe.sshAuthSock}`)
  if (probe.sockets.length > 0)
    found.push(
      `${key} had sockets under /run/buildkit: ${probe.sockets.join(", ")}`
    )
  if (seen.network === "none") {
    const up = probe.interfaces.filter(
      (name) => name !== "lo" && !FALLBACK_TUNNELS.has(name)
    )
    if (up.length > 0)
      found.push(`${key} had network interfaces ${up.join(", ")}`)
    const addressed = (probe.addresses ?? []).filter(
      (item) => !isLoopback(item.address)
    )
    if (addressed.length > 0)
      found.push(
        `${key} had addresses beyond loopback: ${addressed.map((item) => `${item.name} ${item.address}`).join(", ")}`
      )
    if (reached(probe.reach))
      found.push(`${key} reached the stand-in's sshd: ${probe.reach}`)
  }
  return found
}

/** A case as the record line says it, under `label` (its key when absent). */
export function caseWords(
  seen: CaseSeen,
  control?: Probe,
  label: string = seen.key
): string {
  if (!seen.built)
    return `${label}: not built: ${seen.error ?? "no error read"}`
  const probe = seen.probe
  if (probe === undefined) return `${label}: built, its step's output not read`
  const addresses =
    probe.addresses === undefined
      ? "no ip"
      : probe.addresses
          .map((item) => `${item.name} ${item.address}`)
          .join(", ") || "no address"
  const devices =
    control === undefined
      ? `/dev ${probe.devices.join(" ")}`
      : probe.devices.every((name) => control.devices.includes(name)) &&
          control.devices.every((name) => probe.devices.includes(name))
        ? "/dev as the control's"
        : `/dev ${probe.devices.join(" ")}`
  return [
    `${label}: built`,
    `interfaces ${probe.interfaces.join(" ") || "none"}`,
    addresses,
    devices,
    `CapEff ${probe.capEff ?? "not printed"}`,
    `SSH_AUTH_SOCK=${probe.sshAuthSock || "(unset)"} ${probe.sshSocket ? "a socket" : "no socket"}`,
    `sockets under /run/buildkit: ${probe.sockets.join(" ") || "none"}`,
    ...(probe.reach === "not-tried"
      ? []
      : [
          `port 22 of the stand-in: ${reached(probe.reach) ? "answered" : probe.reach || "no answer"}`,
        ]),
  ].join(", ")
}
