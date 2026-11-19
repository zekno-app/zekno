/**
 * Addresses as the DNS check reads them (specs/015-domains-https,
 * contracts/cli.md, CL5; research R27): whether an address is public, and
 * whether two spellings name the same address. Plain arithmetic on the text
 * of an address that `isIP` took: nothing here looks anything up.
 *
 * Not public: private (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1),
 * link-local (169.254/16, fe80::/10), carrier-grade NAT (100.64/10) and
 * unique-local (fc00::/7), the contract's list; and what no server is
 * reached at either: 0.0.0.0/8, 192.0.0.0/24, 198.18.0.0/15, multicast and
 * the reserved block above it, `::`, ff00::/8, 64:ff9b::/96, 2002::/16, and
 * an address with a zone (security-review.md, S8). An IPv4 address written in
 * IPv6 (`::ffff:10.0.0.1`) is judged as the IPv4 address it is. The
 * documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
 * 2001:db8::/32) count as public: the examples and the tests use them.
 */
import { isIP } from "node:net"

/** The four numbers of an IPv4 address, or undefined for anything else. */
function v4Parts(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined
  return address.split(".").map(Number)
}

/**
 * The eight groups of an IPv6 address as numbers, an IPv4 address in its
 * last two, or undefined for anything else. A zone (`%en0`) is left out.
 */
function v6Groups(text: string): number[] | undefined {
  const address = text.split("%")[0]!
  if (isIP(address) !== 6) return undefined
  let rest = address
  const tail: number[] = []
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(rest)?.[1]
  if (v4 !== undefined) {
    const parts = v4Parts(v4)
    if (parts === undefined) return undefined
    tail.push((parts[0]! << 8) | parts[1]!, (parts[2]! << 8) | parts[3]!)
    rest = rest.slice(0, -v4.length)
    if (rest.endsWith(":") && !rest.endsWith("::")) rest = rest.slice(0, -1)
  }
  const [head, after] = rest.split("::") as [string, string | undefined]
  const read = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((group) => parseInt(group, 16))
  const front = read(head)
  const back = [...read(after ?? ""), ...tail]
  const missing = 8 - front.length - back.length
  if (after === undefined ? missing !== 0 : missing < 0) return undefined
  return [...front, ...Array<number>(Math.max(0, missing)).fill(0), ...back]
}

/** An IPv4 address as `v6Groups` writes one in IPv6 (`::ffff:a.b.c.d`), as its own IPv4 text. */
function mappedV4(groups: readonly number[]): string | undefined {
  if (!groups.slice(0, 5).every((group) => group === 0)) return undefined
  if (groups[5] !== 0xffff) return undefined
  return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255]
    .map(String)
    .join(".")
}

function v4Public(parts: readonly number[]): boolean {
  const [a, b] = parts as [number, number]
  if (a === 10 || a === 127) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 169 && b === 254) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  // "This network", the protocol assignments (192.0.0.0/24), benchmarking (198.18.0.0/15), multicast and what is reserved above it.
  if (a === 0 || a >= 224) return false
  if (a === 192 && b === 0 && parts[2] === 0) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  return true
}

/** Whether an address is public, by the ranges above. Anything that is not an address is not. */
export function isPublicAddress(address: string): boolean {
  const v4 = v4Parts(address)
  if (v4 !== undefined) return v4Public(v4)
  // An address with a zone is one of this machine's own links.
  if (address.includes("%")) return false
  const groups = v6Groups(address)
  if (groups === undefined) return false
  const mapped = mappedV4(groups)
  if (mapped !== undefined) return v4Public(v4Parts(mapped)!)
  // `::` and `::1`.
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7]! <= 1)
    return false
  // Multicast, and an IPv4 address carried in IPv6 by a translator (64:ff9b::/96) or by 6to4 (2002::/16).
  if ((groups[0]! & 0xff00) === 0xff00) return false
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return false
  if (groups[0] === 0x2002) return false
  if ((groups[0]! & 0xffc0) === 0xfe80) return false
  if ((groups[0]! & 0xfe00) === 0xfc00) return false
  return true
}

/** One spelling of an address, for comparing: IPv4 as it is, IPv6 as its eight groups, an IPv4 address in IPv6 as that IPv4 address. */
export function addressKey(address: string): string | undefined {
  if (v4Parts(address) !== undefined) return address
  const groups = v6Groups(address)
  if (groups === undefined) return undefined
  return mappedV4(groups) ?? groups.map((group) => group.toString(16)).join(":")
}

/** The first of `found` that is one of `ours`, as `found` spells it; undefined when none is. */
export function firstShared(
  found: readonly string[],
  ours: readonly string[]
): string | undefined {
  const keys = new Set(ours.map(addressKey).filter((key) => key !== undefined))
  return found.find((address) => {
    const key = addressKey(address)
    return key !== undefined && keys.has(key)
  })
}
