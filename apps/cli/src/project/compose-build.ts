/**
 * A Compose file written by hand that asks Docker to build, or names the
 * space reserved for the images zekno builds (specs/016-build-from-source,
 * contracts/cli.md CL6, last item; FR-074's stated exception, FR-075,
 * FR-077; tasks T113): C8 or C9, said before anything is signed, exit status
 * 1, where the Compose file is read for a deploy (compose-read.ts). zekno
 * builds from a settings file only, and no image of a deploy may stand in
 * for one a runner built.
 *
 * The file is untrusted text, read as compose-file.ts reads one: bounded,
 * its aliases counted before it is parsed, every exception caught. C8 looks
 * at each service of what Compose would read, merge keys and escapes
 * resolved: a `build` key in any form. C9 looks at each service's image as
 * Compose would read it, then at the whole text as core's rule of the
 * Compose text does (CO2: any `zekno.invalid/`, in any case, wherever it
 * stands, which a runner refuses), with any port. A text that cannot be
 * parsed is left to the deploy, as today. A name from the file is cleaned
 * and bounded before it is put in a line.
 */
import { namesReservedRegistry } from "@workspace/core"

import { sanitize } from "../server/sanitize"
import { BuildStop } from "../shared/build-lines"
import { COMPOSE_READ_BYTES, tooManyAliases } from "./compose-file"

/** The most characters of a name from the file put into a line. */
const SHOWN = 255

/** `zekno.invalid/`, in any case, with a port or none, as text. */
const RESERVED = /zekno\.invalid(?::[0-9]*)?\//i

/** A character that goes on an image reference, to show the whole name a match stands in. */
const REFERENCE = /[A-Za-z0-9_.\-:@/]/

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A name from the file as a line may hold it: cleaned and bounded. */
const shown = (text: string): string => sanitize(text).slice(0, SHOWN)

/** Whether an image, as Compose reads it, names the reserved space: its registry, or `zekno.invalid/` anywhere in it. */
function reserved(image: string): boolean {
  const slash = image.indexOf("/")
  return (
    (slash !== -1 && namesReservedRegistry(image.slice(0, slash))) ||
    RESERVED.test(image)
  )
}

/** The services of the file as Compose would read them, or undefined when it cannot be parsed within the bounds. */
function servicesOf(text: string): Record<string, unknown> | undefined {
  if (text.length > COMPOSE_READ_BYTES || tooManyAliases(text)) return undefined
  try {
    const parsed: unknown = Bun.YAML.parse(text)
    return isMap(parsed) && isMap(parsed.services) ? parsed.services : undefined
  } catch {
    return undefined
  }
}

/** The reference a `zekno.invalid/` found in the text stands in, from the characters around it. */
function referenceAt(text: string, at: number): string {
  let start = at
  while (start > 0 && REFERENCE.test(text[start - 1]!) && at - start < SHOWN)
    start--
  let end = at
  while (end < text.length && REFERENCE.test(text[end]!) && end - start < SHOWN)
    end++
  return text.slice(start, end)
}

/**
 * C8 or C9 for a Compose file written by hand, `file` as zekno shows it, or
 * undefined when neither applies: the first service, in the file's order,
 * that asks Docker to build (C8) or runs an image under `zekno.invalid`
 * (C9), then a `zekno.invalid/` anywhere in the text (C9).
 */
export function handComposeStop(
  text: string,
  file: string
): BuildStop | undefined {
  for (const [name, service] of Object.entries(servicesOf(text) ?? {})) {
    if (!isMap(service)) continue
    if (Object.hasOwn(service, "build"))
      return new BuildStop({ id: "C8", file, service: shown(name) })
    const { image } = service
    if (typeof image === "string" && reserved(image))
      return new BuildStop({ id: "C9", file, image: shown(image) })
  }
  const found = RESERVED.exec(text)
  return found === null
    ? undefined
    : new BuildStop({
        id: "C9",
        file,
        image: shown(referenceAt(text, found.index)),
      })
}
