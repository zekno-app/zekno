/**
 * The summary's "read by" is true (specs/012-templates, security review T1;
 * contracts/commands.md, "The order of checks", step 11; FR-005): for every
 * addition `planAddition` accepts, the services whose Compose text carries
 * each secret the template makes or builds (`"NAME": "${NAME}"`) are exactly
 * the services the summary names for it. A service of the file that already
 * lists one of those names in its secrets would read it unnamed; it is
 * refused (AD29), and a plain variable of that name, which reads no secret,
 * is left as it is.
 *
 * The files are made by a seeded generator, so every run tries the same
 * cases: one to four services, each name of the template (and one other)
 * listed as a secret, written as a plain variable, or neither, and the
 * readers chosen at random.
 */
import { describe, expect, test } from "bun:test"

import { composeText } from "../../src/settings/compose"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import { planAddition } from "../../src/templates/addition"
import { additionReport } from "../../src/templates/shown"
import type { Addition, Template } from "../../src/templates/types"
import { FIRST_TEMPLATES, GOOD } from "../support/template-files"

const FILE = "zekno.app.json"
const NAMES = ["web", "worker", "cron", "api"]

/** A small linear congruential generator, seeded, so the cases are the same on every run. */
function generator(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state >>> 8
  }
}

/** The templates tried: the first set, and acme-db of two services. */
const TEMPLATES: Template[] = [
  ...Object.values(FIRST_TEMPLATES),
  GOOD.find((good) => good.template.services.length === 2)!.template,
]

/** The names a template stores: the made secrets, then the connection secrets. */
const stored = (template: Template): string[] => [
  ...template.makes.map((made) => made.name),
  ...template.offers.map((offer) => offer.name),
]

/** For each service of a Compose text, the secrets it is given: the variables written `"${NAME}"`. */
function carried(text: string): Map<string, Set<string>> {
  const parsed = Bun.YAML.parse(text) as {
    services: Record<string, { environment?: Record<string, string> }>
  }
  return new Map(
    Object.entries(parsed.services).map(([service, each]) => [
      service,
      new Set(
        Object.entries(each.environment ?? {})
          .filter(([name, value]) => value === `\${${name}}`)
          .map(([name]) => name)
      ),
    ])
  )
}

/** The services the Compose text gives `secret`, in the text's order. */
const carriers = (text: string, secret: string): string[] =>
  [...carried(text)]
    .filter(([, secrets]) => secrets.has(secret))
    .map(([service]) => service)

/** What the summary says of each stored name: the services it names after `read by`. */
function readBy(addition: Addition, services: readonly string[]) {
  const report = additionReport({
    addition,
    app: "demo",
    server: { name: "dev", where: "this machine" },
    file: FILE,
    services,
  })
  return new Map([
    ...report.made.map((made) => [made.name, made.readBy] as const),
    ...report.offers.map((offer) => [offer.name, offer.readBy] as const),
  ])
}

/** The plan once every question is answered with `pick`. */
function answered(
  input: Parameters<typeof planAddition>[0],
  pick: (services: readonly string[]) => string[]
) {
  const plan = planAddition(input)
  if (!("ask" in plan)) return plan
  return planAddition({
    ...input,
    readers: new Map(
      plan.ask.map(({ offer, services }) => [offer, pick(services)])
    ),
  })
}

describe("the summary's read by is the Compose text's (security review T1)", () => {
  test("2,000 files made at random: every addition accepted gives each secret to exactly the services the summary names", () => {
    const next = generator(0x7101)
    const some = (services: readonly string[]): string[] => {
      const picked = services.filter(() => next() % 2 === 0)
      return picked.length > 0 ? picked : [services[next() % services.length]!]
    }
    let accepted = 0
    const refusals = new Map<string, number>()
    for (let index = 0; index < 2000; index++) {
      const template = TEMPLATES[next() % TEMPLATES.length]!
      const pool = [...stored(template), "OTHER"]
      const count = 1 + (next() % NAMES.length)
      const services = NAMES.slice(0, count).map(
        (name): readonly [string, ServiceSettings] => {
          const secrets: string[] = []
          const plain: [string, string][] = []
          // Most names left out, so that many files are accepted.
          for (const each of pool) {
            const roll = next() % 8
            if (roll === 0) secrets.push(each)
            else if (roll === 1) plain.push([each, "x"])
          }
          return [
            name,
            {
              image: "ghcr.io/acme/web:1",
              ...(secrets.length > 0 ? { secrets } : {}),
              ...(plain.length > 0 ? { plain } : {}),
            },
          ]
        }
      )
      const settings: Settings = { version: 1, services }
      const names = services.map(([name]) => name)
      const plan = answered(
        {
          template,
          settings,
          file: FILE,
          ...(next() % 2 === 0 ? { readers: some(names) } : {}),
        },
        some
      )
      if ("ask" in plan) throw new Error("a question was left")
      if ("id" in plan) {
        refusals.set(plan.id, (refusals.get(plan.id) ?? 0) + 1)
        continue
      }
      accepted++
      const text = composeText(plan.settings)
      const said = readBy(plan, names)
      for (const secret of stored(template))
        expect({ secret, carried: carriers(text, secret) }).toEqual({
          secret,
          carried: [...(said.get(secret) ?? [])],
        })
    }
    // Enough of each kind for the test to mean something.
    expect(accepted).toBeGreaterThan(300)
    expect(refusals.get("AD29") ?? 0).toBeGreaterThan(300)
    expect(refusals.get("AD7") ?? 0).toBeGreaterThan(30)
  })

  test("the review's two files: worker listing POSTGRES_PASSWORD, or DATABASE_URL, and --for web, are refused naming worker", () => {
    for (const secret of ["POSTGRES_PASSWORD", "DATABASE_URL"]) {
      const plan = planAddition({
        template: FIRST_TEMPLATES.postgres!,
        settings: {
          version: 1,
          services: [
            ["web", { image: "example/web:1" }],
            [
              "worker",
              { image: "example/vendor-sidecar:1", secrets: [secret] },
            ],
          ],
        },
        file: FILE,
        readers: ["web"],
      })
      expect(plan).toEqual({
        id: "AD29",
        sentence: `worker already reads a secret named ${secret}. Remove it from worker.`,
        status: 2,
      })
    }
  })
})
