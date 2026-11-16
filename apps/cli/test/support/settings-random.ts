/**
 * Helpers of the Compose text tests (specs/010-app-settings,
 * contracts/compose-text.md, "Tests"): what YAML must read from the text of
 * some settings, and a seeded generator of settings within the rules, the
 * same on every run.
 */
import { composeText } from "../../src/settings/compose"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import { joinStart, splitStart } from "../../src/settings/values"

export const IMAGE = "ghcr.io/acme/web:1.4.2"
export const one = (
  service: Partial<ServiceSettings>,
  name = "web"
): Settings => ({
  version: 1,
  services: [[name, { image: IMAGE, ...service }]],
})
/** The lines of one service alone, after `services:`, its name and image. */
export const linesOf = (service: Partial<ServiceSettings>): string[] =>
  composeText(one(service)).split("\n").slice(3, -1)

/** What Compose reads from a value YAML gives: `$$` is one `$`. */
export const composeReads = (value: string): string =>
  value.replace(/\$\$/g, "$")
/** A value as the text holds it once YAML has read it: every `$` doubled. */
export const doubled = (value: string): string => value.replace(/\$/g, "$$$$")

export type Parsed = {
  services: Record<string, Record<string, unknown>>
  volumes?: Record<string, unknown>
}

/** What YAML must give for these settings, value by value: anything else means a value left its place. */
export function expectedYaml(settings: Settings): Parsed {
  const services: Parsed["services"] = {}
  const volumes: Record<string, unknown> = {}
  for (const [name, s] of settings.services) {
    const service: Record<string, unknown> = { image: s.image }
    if (s.start !== undefined) {
      const split = splitStart(s.start)
      if (!("words" in split))
        throw new Error("a start command that does not split")
      service.command = split.words.map(doubled)
    }
    if (s.restart !== undefined) service.restart = s.restart
    if (s.memory !== undefined) service.mem_limit = s.memory
    if (s.cpus !== undefined) service.cpus = Number(s.cpus)
    if (s.port !== undefined)
      if (s.publish === undefined) service.expose = [String(s.port)]
      else service.ports = [`${s.publish}:${s.port}`]
    // Built with Object.fromEntries, as YAML builds it: a name such as __proto__ is an own key, never a prototype.
    const environment = Object.fromEntries([
      ...(s.secrets ?? []).map((secret) => [secret, `\${${secret}}`]),
      ...(s.plain ?? []).map(([variable, value]) => [variable, doubled(value)]),
    ])
    if (Object.keys(environment).length > 0) service.environment = environment
    if (s.volumes?.length) {
      service.volumes = s.volumes.map(([source, target]) => ({
        type: "volume",
        source,
        target,
      }))
      for (const [volume] of s.volumes) volumes[volume] = {}
    }
    services[name] = service
  }
  return Object.keys(volumes).length > 0 ? { services, volumes } : { services }
}

/** A small linear congruential generator, seeded, so the thousand settings are the same on every run. */
export function generator(seed: number) {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
  const below = (n: number): number => Math.floor(next() * n)
  const pick = <T>(items: readonly T[]): T => items[below(items.length)]!
  const chance = (p: number): boolean => next() < p
  return { below, pick, chance }
}

const POOL = [
  '"',
  "\\",
  "$",
  "${X}",
  "#",
  ": ",
  "- ",
  "&",
  "*",
  "!",
  "|",
  ">",
  "'",
  "{",
  "}",
  "[",
  "]",
  ",",
  "?",
  "%",
  "@",
  "`",
  "no",
  "true",
  "null",
  "~",
  "1e3",
  "0x1F",
  "2026-11-16",
  "1_000",
  "é",
  "Ünïcödé",
  "東京",
  "🚀",
  " ",
  "x",
  "yes",
  "a: b",
]
const SERVICE_NAMES = [
  "web",
  "worker",
  "api",
  "true",
  "null",
  "constructor",
  "a-1",
  "x",
  "no",
  "yes",
]
const IMAGES = [
  "nginx:1.27",
  "ghcr.io/acme/web:1.4.2",
  "localhost:5000/a/b:tag",
  `ghcr.io/x@sha256:${"a".repeat(64)}`,
]
const SECRET_NAMES = [
  "DATABASE_URL",
  "SESSION_KEY",
  "A",
  "_B",
  "c1",
  "API_TOKEN",
  "__proto__",
  "constructor",
]
const PLAIN_NAMES = [
  "NODE_ENV",
  "PATH",
  "X",
  "y_1",
  "__proto__",
  "toString",
  "LONG_NAME_HERE",
]
const VOLUME_NAMES = ["data", "uploads", "a_b", "c-d", "constructor"]

/** Settings within the rules, drawn by `random`. */
export function randomSettings(random: ReturnType<typeof generator>): Settings {
  const count = 1 + random.below(3)
  const names = [...SERVICE_NAMES]
    .sort(() => random.below(3) - 1)
    .slice(0, count)
  const published = new Set<number>()
  const text = () =>
    Array.from({ length: 1 + random.below(3) }, () => random.pick(POOL)).join(
      ""
    )
  return {
    version: 1,
    services: names.map((name) => {
      const service: {
        -readonly [Key in keyof ServiceSettings]: ServiceSettings[Key]
      } = { image: random.pick(IMAGES) }
      if (random.chance(0.6))
        service.start = joinStart(
          Array.from({ length: 1 + random.below(4) }, text)
        )
      if (random.chance(0.4))
        service.restart = random.pick(["no", "on-failure", "always"] as const)
      if (random.chance(0.4))
        service.memory = random.pick(["6m", "512m", "1g", "99999g"])
      if (random.chance(0.4))
        service.cpus = random.pick(["0.01", "0.5", "1", "2.25", "1024"])
      if (random.chance(0.6)) {
        service.port = 1 + random.below(65535)
        const publish = 1 + random.below(65535)
        if (random.chance(0.5) && !published.has(publish)) {
          service.publish = publish
          published.add(publish)
        }
      }
      const secrets = SECRET_NAMES.filter(() => random.chance(0.3))
      if (secrets.length > 0) service.secrets = secrets
      const plain = PLAIN_NAMES.filter(
        (each) => !secrets.includes(each) && random.chance(0.3)
      ).map((each) => [each, text()] as const)
      if (plain.length > 0) service.plain = plain
      const volumes = VOLUME_NAMES.filter(() => random.chance(0.25)).map(
        (each, at) => [each, `/v${at}/${each}`] as const
      )
      if (volumes.length > 0) service.volumes = volumes
      return [name, service] as const
    }),
  }
}
