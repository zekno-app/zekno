/**
 * `ADD` of a remote source (specs/016-build-from-source, contracts/cli.md
 * CL3, "Refused before signing" and "C13's set, exactly"; FR-042a). Each
 * source of each `ADD` is read as an image name is (`dockerfile/images.ts`):
 * expanded in its stage's scope, for both platforms, with the plain variables
 * given to the build; `ONBUILD` lines are not run here (plan.md item 17).
 *
 * A source is remote when it starts with a scheme (`<scheme>://`), is an
 * SCP-like address (`user@host:path`), or starts `github.com/`: wider than
 * BuildKit's own reading, so nothing BuildKit fetches is taken for a local
 * file. Stops before signing, exit status 1 (CL11):
 *
 * - C13: a remote source whose host is in C13's set, with a checksum or not
 *   (said first: a checksum does not lift it);
 * - C12: any other remote source with no `--checksum`;
 * - C11: a source zekno cannot resolve that could be remote. One whose
 *   written start already makes it a local path is local, whatever its
 *   variables give.
 *
 * The check is lexical: a name that resolves to such an address on the
 * server, and a redirect from a public address, are not caught (CL3); the
 * checksum is what holds a fetch to its content.
 */
import type { Target } from "../server/transport"
import { BuildStop } from "../shared/build-lines"
import { type BuildArgs, PLATFORMS, stageScope } from "./expand"
import { expandIn, variableOf } from "./images"
import type { DockerfileReading } from "./instructions"

/** What zekno checks the `ADD` lines of one service's Dockerfile with. */
export type AddCheck = {
  service: string
  reading: DockerfileReading
  /** The plain variables given to the build (`ops/build-reads.ts`). */
  given: BuildArgs
  /** The server's own names and addresses as zekno knows them (`serverAddresses`). */
  server: readonly string[]
}

/**
 * The server's own name and address as zekno knows them: its name in this
 * machine's profile, and the host of its SSH destination (after the last
 * `@`). A runner on this machine has its name alone.
 */
export function serverAddresses(server: {
  name: string
  target: Target
}): string[] {
  if (server.target.kind !== "ssh") return [server.name]
  const { destination } = server.target
  return [server.name, destination.slice(destination.lastIndexOf("@") + 1)]
}

/** A source with a scheme: letters, then `://`. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
/** An SCP-like address: a user before any `/`, then a host, bracketed or up to its `:`. */
const SCP = /^[^/@]+@(\[[^\]/]*\]|[^/:]*):/
/** BuildKit reads `github.com/…` as a repository. */
const GITHUB = /^github\.com\//i

/**
 * The host of an address with a scheme as Go's `net/url` reads it, the
 * reader of BuildKit's fetcher: the fragment, then the query cut off; the
 * authority up to the first `/`; the user up to the last `@` dropped; the
 * port dropped after a bracketed host, else after the last `:`.
 */
function goHost(url: string): string {
  const rest = url
    .slice(url.indexOf(":") + 3)
    .split("#")[0]!
    .split("?")[0]!
  const slash = rest.indexOf("/")
  const authority = slash < 0 ? rest : rest.slice(0, slash)
  const host = authority.slice(authority.lastIndexOf("@") + 1)
  if (host.startsWith("[")) {
    const close = host.lastIndexOf("]")
    return close < 0 ? host : host.slice(0, close + 1)
  }
  const colon = host.lastIndexOf(":")
  return colon < 0 ? host : host.slice(0, colon)
}

/** The host as the WHATWG reader reads it (a `\` read as `/`, numbers in other bases read), none when it refuses the address. */
function whatwgHost(url: string): string[] {
  try {
    return [new URL(url).hostname]
  } catch {
    return []
  }
}

/** The hosts a remote source may be fetched from, each reader's; undefined for a local source. */
function remoteHosts(source: string): string[] | undefined {
  if (SCHEME.test(source)) return [goHost(source), ...whatwgHost(source)]
  const scp = SCP.exec(source)
  if (scp !== null) return [scp[1]!]
  if (GITHUB.test(source)) return ["github.com"]
  return undefined
}

/**
 * A source whose written start makes it local whatever its variables give:
 * text before the first `$`, quote or escape character that holds a `/`,
 * with no scheme's colon, no `@` and not `github.com` before that `/`. A
 * byte order mark at the start is dropped first, as BuildKit's lexer drops
 * it.
 */
function surelyLocal(source: string, escape: string): boolean {
  const text = source.replace(/^\ufeff/, "")
  const special = [...text].findIndex((char) =>
    ["$", "'", '"', escape].includes(char)
  )
  const written = special < 0 ? text : [...text].slice(0, special).join("")
  const slash = written.indexOf("/")
  if (slash < 0) return false
  const head = written.slice(0, slash)
  return (
    !/^[A-Za-z][A-Za-z0-9+.-]*:$/.test(head) &&
    !head.includes("@") &&
    head.toLowerCase() !== "github.com"
  )
}

/**
 * Every `ADD` of a service's Dockerfile checked: C13, C12 and C11 are thrown
 * before anything is signed.
 */
export function checkAdds(check: AddCheck): void {
  const { reading, given, service } = check
  reading.stages.forEach((stage, index) => {
    stage.commands.forEach((command, at) => {
      if (command.kind !== "add" || command.onbuild) return
      for (const source of command.sources)
        for (const platform of PLATFORMS) {
          const found = expandIn(source, reading, () =>
            stageScope(reading, index, at, platform, given)
          )
          if (!found.ok) {
            if (surelyLocal(source, reading.directives.escape)) continue
            throw new BuildStop({
              id: "C11",
              service,
              instruction: `ADD ${source}`,
              line: command.line,
              variable: variableOf(source, found),
            })
          }
          const hosts = remoteHosts(found.value)
          if (hosts === undefined) continue
          const line = { service, url: found.value, line: command.line }
          if (hosts.some((host) => isRefusedHost(host, check.server)))
            throw new BuildStop({ id: "C13", ...line })
          if (command.checksum === null)
            throw new BuildStop({ id: "C12", ...line })
        }
    })
  })
}

/** Percent escapes read as a fetcher reads them: the whole as UTF-8, else each ASCII one. */
function unescaped(host: string): string {
  try {
    return decodeURIComponent(host)
  } catch {
    return host.replace(/%([0-7][0-9a-fA-F])/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
  }
}

/**
 * A host as a resolver reads it, then as CL3 reads it: escapes read, full-
 * width forms and ideographic dots folded as IDNA folds them, lowercased; one
 * pair of brackets and one trailing dot removed.
 */
function hostOf(host: string): string {
  let text = unescaped(host)
    .normalize("NFKC")
    .replace(/[\u3002\uff0e\uff61]/g, ".")
    .toLowerCase()
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1)
  if (text.endsWith(".")) text = text.slice(0, -1)
  return text
}

/** A plain dotted-decimal address: four numbers of 0 to 255 with no leading zero. */
const DOTTED = /^(?:(?:0|[1-9][0-9]{0,2})\.){3}(?:0|[1-9][0-9]{0,2})$/

/** An IPv4 address's four bytes, from a plain dotted-decimal one only. */
function ipv4(text: string): number[] | undefined {
  if (!DOTTED.test(text)) return undefined
  const bytes = text.split(".").map(Number)
  return bytes.every((byte) => byte <= 255) ? bytes : undefined
}

/** An IPv6 address's sixteen bytes (a zone after `%` dropped, a last part in dotted decimal read), or undefined. */
function ipv6(text: string): number[] | undefined {
  const address = text.split("%")[0]!
  const halves = address.split("::")
  if (halves.length > 2) return undefined
  const groups = (half: string): number[] | undefined => {
    if (half === "") return []
    const out: number[] = []
    const parts = half.split(":")
    for (const [at, part] of parts.entries()) {
      const four = at === parts.length - 1 ? ipv4(part) : undefined
      if (four !== undefined) {
        out.push((four[0]! << 8) | four[1]!, (four[2]! << 8) | four[3]!)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined
      out.push(parseInt(part, 16))
    }
    return out
  }
  const head = groups(halves[0]!)
  const tail = halves.length === 2 ? groups(halves[1]!) : []
  if (head === undefined || tail === undefined) return undefined
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined
  const words = [...head, ...Array<number>(missing).fill(0), ...tail]
  return words.flatMap((word) => [word >> 8, word & 255])
}

/** The IPv4 ranges of C13's set, as first byte, second byte and the bits of the second that count. */
const IPV4_RANGES: [number, number, number][] = [
  [0, 0, 0], // 0.0.0.0/8
  [127, 0, 0], // 127.0.0.0/8
  [10, 0, 0], // 10.0.0.0/8
  [172, 16, 0xf0], // 172.16.0.0/12
  [192, 168, 0xff], // 192.168.0.0/16
  [169, 254, 0xff], // 169.254.0.0/16, cloud metadata at 169.254.169.254
  [100, 64, 0xc0], // 100.64.0.0/10, metadata at 100.100.100.200 among it
]

const inIpv4Ranges = (bytes: readonly number[]): boolean =>
  IPV4_RANGES.some(
    ([first, second, mask]) =>
      bytes[0] === first && (bytes[1]! & mask) === second
  )

/** The IPv4 address an IPv6 one carries in its mapped (`::ffff:a.b.c.d`) or compatible (`::a.b.c.d`) form, or undefined. */
function carriedIpv4(bytes: readonly number[]): number[] | undefined {
  if (bytes.slice(0, 10).some((byte) => byte !== 0)) return undefined
  const marker = bytes.slice(10, 12)
  if (
    marker.every((byte) => byte === 0xff) ||
    marker.every((byte) => byte === 0)
  )
    return bytes.slice(12)
  return undefined
}

/** Whether an address is in C13's ranges: `::`, `::1`, `fc00::/7`, `fe80::/10`, or an IPv4 range in any form. */
function inRanges(bytes: readonly number[]): boolean {
  if (bytes.length === 4) return inIpv4Ranges(bytes)
  const carried = carriedIpv4(bytes)
  if (carried !== undefined) return inIpv4Ranges(carried)
  return (
    (bytes[0]! & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80)
  )
}

/** A host's address, as four bytes or sixteen, or undefined for a name. */
const addressOf = (host: string): number[] | undefined =>
  host.includes(":") ? ipv6(host) : ipv4(host)

/** An address in the one form two can be compared in: IPv4 as four bytes, whatever IPv6 form carries it. */
const comparable = (bytes: readonly number[]): string =>
  (bytes.length === 16 ? (carriedIpv4(bytes) ?? bytes) : bytes).join(".")

/** A label made only of digits, or of `0x` and hex digits. */
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/

/**
 * Whether a host is in C13's set, exactly as CL3 lists it, read by
 * `hostOf`: `localhost` or a name ending `.localhost`; a single label; the
 * server's own name or address (`server`); an address in the listed ranges,
 * IPv4-mapped and IPv4-compatible forms among them; or only numeric labels
 * that are not a plain dotted-decimal address with no leading zero, which a
 * resolver may read as an address.
 */
export function isRefusedHost(
  host: string,
  server: readonly string[]
): boolean {
  const name = hostOf(host)
  const address = addressOf(name)
  if (address !== undefined && inRanges(address)) return true
  if (address === undefined) {
    if (name === "localhost" || name.endsWith(".localhost")) return true
    if (!name.includes(".")) return true
    if (name.split(".").every((label) => NUMERIC_LABEL.test(label))) return true
  }
  return server.some((own) => {
    const ownName = hostOf(own)
    const ownAddress = addressOf(ownName)
    return address !== undefined && ownAddress !== undefined
      ? comparable(address) === comparable(ownAddress)
      : name === ownName
  })
}
