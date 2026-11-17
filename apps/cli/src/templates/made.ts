/**
 * Made secrets and connection secrets (specs/012-templates, research R6;
 * data-model.md, "A made value").
 *
 * Where a made value may go: it is made here, from the system's random
 * source, by the one function that seals the secrets (ops/add-commit.ts),
 * after the question and the checks that the file and the secret store are
 * unchanged; it lives in that function's local variables and reaches only
 * `createSecret`, which seals and signs it. It is never returned to anyone
 * else, put in a plan, an error, a line, a log, a file other than its
 * sealed record, or an argument. What is shown of a connection secret is
 * `shownOffer`, which holds no value. A JavaScript string cannot be wiped;
 * nothing keeps a reference after that function returns.
 *
 * A password is letters and digits only, so it is safe inside a URL, a
 * configuration line and a shell's double quotes.
 */
import { SUMMARY } from "./add-words"
import type { Offer } from "./types"

/** The 62 characters of a password: capital letters, small letters, digits. */
export const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/** Bytes from here up are thrown away: 248 is 4 times 62, so every character below is equally likely. */
const LIMIT = 248

/**
 * A password of `length` characters of `ALPHABET`, every character equally
 * likely: one byte from `random` per character, a byte of 248 or more thrown
 * away. `random` is the system's random source (Web Crypto), but in tests.
 */
export function makePassword(
  length: number,
  random: (bytes: Uint8Array) => void = (bytes) => {
    crypto.getRandomValues(bytes)
  }
): string {
  let password = ""
  const bytes = new Uint8Array(length)
  for (let round = 0; password.length < length; round++) {
    // A source that keeps giving only bytes thrown away is broken: stop, never loop for ever.
    if (round === 1000)
      throw new Error("The random source gave no usable byte.")
    random(bytes)
    for (const byte of bytes) {
      if (byte >= LIMIT) continue
      password += ALPHABET[byte % ALPHABET.length]
      if (password.length === length) break
    }
  }
  bytes.fill(0)
  return password
}

/** A placeholder of an offer: `{service}` or `{NAME}`, a made secret's name (read.ts held each to TF19 and TF28). */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g

/**
 * An offer's text with `{service}` and each `{MADE}` filled in: the
 * connection secret's value, to be sealed at once. `service` is the name the
 * template's first service gets in the app (D19). A placeholder with no made
 * value is a fault of this program, said without any value.
 */
export function fillOffer(
  offer: Offer,
  service: string,
  made: ReadonlyMap<string, string>
): string {
  return offer.text.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "service") return service
    const value = made.get(name)
    if (value === undefined)
      throw new Error("A connection secret names a secret that was not made.")
    return value
  })
}

/** The same text for a person: the service's name in place of `{service}`, and `••••` in place of each made value. */
export function shownOffer(
  offer: Offer,
  service: string
): { text: string; hidden: boolean }[] {
  const pieces: { text: string; hidden: boolean }[] = []
  const fixed = (text: string): void => {
    if (text === "") return
    const last = pieces.at(-1)
    if (last !== undefined && !last.hidden) last.text += text
    else pieces.push({ text, hidden: false })
  }
  let at = 0
  for (const found of offer.text.matchAll(PLACEHOLDER)) {
    fixed(offer.text.slice(at, found.index))
    if (found[1] === "service") fixed(service)
    else pieces.push({ text: SUMMARY.hidden, hidden: true })
    at = found.index + found[0].length
  }
  fixed(offer.text.slice(at))
  return pieces
}
