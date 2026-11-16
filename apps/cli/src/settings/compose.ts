/**
 * The Compose text an app's settings turn into (specs/010-app-settings,
 * contracts/compose-text.md; research R2), and reading such a text back into
 * settings for "changed, not deployed" (research R4).
 *
 * This text is what a deploy checks, signs, sends and records, so it is
 * written here line by line, never by a YAML library: the same settings give
 * the same bytes on every machine and every Bun version. The rules:
 *
 * - The keys Compose defines are written plain; they are this program's own.
 * - Every name from the settings (a service, a variable, a volume) and every
 *   string value is a YAML double-quoted scalar made by `quote`: `\` written
 *   `\\`, then `"` written `\"`, then every `$` written `$$`, which Compose
 *   reads as one literal `$`. Nothing else is escaped: a setting holds no
 *   character that would need it (values.ts, `holdsOnlyAllowed`), so no value
 *   can end its scalar, start a comment, a tag, an anchor, an alias, a flow
 *   collection or a new line, or become a variable.
 * - The one place the text asks Compose for a variable is a secret,
 *   `"NAME": "${NAME}"`, its name held to the secret-name rule. No value of a
 *   secret is ever in the text.
 * - The start command is a flow list of the words split on this machine
 *   (exec form): Compose runs exactly those words, with no shell.
 * - The only plain number is `cpus`, from its checked text, never with an
 *   exponent. Ports go into strings.
 * - A volume is written in Compose's long form, `type: "volume"`, so it can
 *   only ever be a named volume, never a folder of the server.
 *
 * Nothing here imports schema.ts: the text is made from settings already
 * checked, and schema.ts uses `composeText` for the size rule (SV33).
 */
import { COMPOSE_READ_BYTES, tooManyAliases } from "../project/compose-file"
import type { ServiceSettings, Settings } from "./types"
import { joinStart, splitStart } from "./values"

/** A YAML double-quoted scalar of `text`, with `\`, `"` and `$` escaped as the rules above say. */
export function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, () => "$$")
  return `"${escaped}"`
}

/** The lines of one service, in the order of contracts/compose-text.md, "Each setting". */
function serviceLines(name: string, service: ServiceSettings): string[] {
  const lines = [`  ${quote(name)}:`, `    image: ${quote(service.image)}`]
  if (service.start !== undefined) {
    const split = splitStart(service.start)
    // Settings that reach here were checked; a start command that does not split is a fault of this program.
    if ("problem" in split)
      throw new Error("A start command that does not split was given.")
    lines.push(`    command: [${split.words.map(quote).join(", ")}]`)
  }
  if (service.restart !== undefined)
    lines.push(`    restart: ${quote(service.restart)}`)
  if (service.memory !== undefined)
    lines.push(`    mem_limit: ${quote(service.memory)}`)
  if (service.cpus !== undefined)
    lines.push(`    cpus: ${String(Number(service.cpus))}`)
  if (service.port !== undefined)
    lines.push(
      service.publish === undefined
        ? `    expose: [${quote(String(service.port))}]`
        : `    ports: [${quote(`${service.publish}:${service.port}`)}]`
    )
  const secrets = service.secrets ?? []
  const plain = service.plain ?? []
  if (secrets.length + plain.length > 0) {
    lines.push("    environment:")
    for (const secret of secrets)
      lines.push(`      ${quote(secret)}: "\${${secret}}"`)
    for (const [variable, value] of plain)
      lines.push(`      ${quote(variable)}: ${quote(value)}`)
  }
  const volumes = service.volumes ?? []
  if (volumes.length > 0) {
    lines.push("    volumes:")
    for (const [volume, path] of volumes)
      lines.push(
        '      - type: "volume"',
        `        source: ${quote(volume)}`,
        `        target: ${quote(path)}`
      )
  }
  return lines
}

/** The Compose text of checked settings, exactly as contracts/compose-text.md writes it. */
export function composeText(settings: Settings): string {
  const lines = ["services:"]
  const volumes: string[] = []
  for (const [name, service] of settings.services) {
    lines.push(...serviceLines(name, service))
    for (const [volume] of service.volumes ?? [])
      if (!volumes.includes(volume)) volumes.push(volume)
  }
  if (volumes.length > 0) {
    lines.push("volumes:")
    for (const volume of volumes) lines.push(`  ${quote(volume)}: {}`)
  }
  return `${lines.join("\n")}\n`
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

/** A Compose value written by `quote`, as YAML reads it, back to the setting's value: `$$` is one `$`. */
const unescaped = (text: string): string => text.replace(/\$\$/g, () => "$")

/** One service of a parsed Compose text, mapped back by the lines `serviceLines` writes. Undefined when it is not that shape. */
function serviceOf(parsed: unknown): ServiceSettings | undefined {
  if (!isMap(parsed) || typeof parsed.image !== "string") return undefined
  const service: {
    -readonly [Key in keyof ServiceSettings]: ServiceSettings[Key]
  } = { image: unescaped(parsed.image) }
  if (parsed.command !== undefined) {
    if (!isStrings(parsed.command)) return undefined
    service.start = joinStart(parsed.command.map(unescaped))
  }
  if (parsed.restart !== undefined) {
    if (typeof parsed.restart !== "string") return undefined
    service.restart = unescaped(parsed.restart) as ServiceSettings["restart"]
  }
  if (parsed.mem_limit !== undefined) {
    if (typeof parsed.mem_limit !== "string") return undefined
    service.memory = unescaped(parsed.mem_limit)
  }
  if (parsed.cpus !== undefined) {
    if (typeof parsed.cpus !== "number") return undefined
    service.cpus = String(parsed.cpus)
  }
  if (parsed.expose !== undefined) {
    if (!isStrings(parsed.expose) || parsed.expose.length !== 1)
      return undefined
    service.port = Number(parsed.expose[0])
  }
  if (parsed.ports !== undefined) {
    if (!isStrings(parsed.ports) || parsed.ports.length !== 1) return undefined
    const [publish, port] = parsed.ports[0]!.split(":")
    service.publish = Number(publish)
    service.port = Number(port)
  }
  if (parsed.environment !== undefined) {
    if (!isMap(parsed.environment)) return undefined
    const secrets: string[] = []
    const plain: (readonly [string, string])[] = []
    for (const [name, value] of Object.entries(parsed.environment)) {
      if (typeof value !== "string") return undefined
      // A secret is the one value that asks for a variable; a plain value's `$` is always doubled.
      if (value === `\${${name}}`) secrets.push(name)
      else plain.push([name, unescaped(value)])
    }
    if (secrets.length > 0) service.secrets = secrets
    if (plain.length > 0) service.plain = plain
  }
  if (parsed.volumes !== undefined) {
    if (!Array.isArray(parsed.volumes)) return undefined
    const volumes: (readonly [string, string])[] = []
    for (const volume of parsed.volumes) {
      if (
        !isMap(volume) ||
        typeof volume.source !== "string" ||
        typeof volume.target !== "string"
      )
        return undefined
      volumes.push([unescaped(volume.source), unescaped(volume.target)])
    }
    service.volumes = volumes
  }
  return service
}

/**
 * The settings a Compose text was made from, or undefined when it was not
 * made by `composeText` (a Compose file written by hand, or one from a later
 * zekno): what is read back counts only when writing it again gives these
 * very bytes. The text is bounded and its aliases counted before it is
 * parsed, as `composeServices` does; every exception gives undefined. Only
 * compared, never signed, sent or written.
 */
export function deployedSettings(text: string): Settings | undefined {
  if (Buffer.byteLength(text) > COMPOSE_READ_BYTES || tooManyAliases(text))
    return undefined
  try {
    const parsed: unknown = Bun.YAML.parse(text)
    if (!isMap(parsed) || !isMap(parsed.services)) return undefined
    const services: (readonly [string, ServiceSettings])[] = []
    for (const [name, value] of Object.entries(parsed.services)) {
      const service = serviceOf(value)
      if (service === undefined) return undefined
      services.push([name, service])
    }
    const settings: Settings = { version: 1, services }
    return composeText(settings) === text ? settings : undefined
  } catch {
    return undefined
  }
}
