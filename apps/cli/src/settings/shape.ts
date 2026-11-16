/**
 * The shape of a settings file (specs/010-app-settings,
 * contracts/settings-file.md, "The settings"), declared with zod
 * `strictObject`s as `zekno.json`'s is (the maintainer's decision 1): every
 * section and its keys, the later settings as optional keys of their own
 * sections, and each value held to its rule in values.ts. schema.ts gives it
 * the file and turns what it says into the contract's sentences.
 *
 * Each issue carries the id of its sentence as its message, never a piece
 * of the file: schema.ts builds the place from the id and the issue's path,
 * and puts a name into it only once the name passed its rule.
 */
import { z } from "zod"

import type { LaterSetting } from "./types"
import {
  checkCpus,
  checkMemory,
  checkMountPath,
  checkPlainName,
  checkPlainValue,
  checkPort,
  checkRestart,
  checkServiceName,
  checkVolumeName,
  isImage,
  MAX_PLAIN,
  MAX_SECRETS,
  MAX_SERVICES,
  MAX_VOLUMES,
  secretNameProblem,
  startProblem,
} from "./values"

/** A JSON number as the file wrote it: its text (for `cpus`, and to tell `1` from `1.0`) and its value. */
export class JsonNumber {
  constructor(
    readonly text: string,
    readonly value: number
  ) {}
}

/**
 * Each zod issue carries the id of its sentence as its message, so a fault
 * is built from the id and the issue's place only. `SV9:<problem>` is SV9
 * with its reason.
 */
const fails = (id: string) => ({ error: id })

/** A string held to `check`; `missing` and `wrong` are the ids for no string and for one that breaks the rule. */
const checkedString = (
  wrong: string,
  check: (text: string) => boolean,
  missing = wrong
) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? missing : wrong) })
    .refine(check, fails(wrong))

/** A JSON number held to `check`, which reads its text. */
const checkedNumber = (
  id: string,
  check: (text: string) => string | undefined
) =>
  z
    .custom<JsonNumber>((value) => value instanceof JsonNumber, fails(id))
    .refine((number) => check(number.text) === undefined, fails(id))

/**
 * A count (SV2, SV3, SV21, SV26, SV31) is checked whenever its list or
 * object is one, even when an entry is wrong: it is at the place of its list
 * or object, so it is said before a fault of one of its entries.
 */
const counted = (
  id: string,
  is: (value: unknown) => boolean
): { error: string; when: (payload: { value: unknown }) => boolean } => ({
  error: id,
  when: (payload) => is(payload.value),
})
const isList = (value: unknown): boolean => Array.isArray(value)
const isMap = (value: unknown): boolean => value instanceof Map

/** A setting a later version brings: kept as an optional key of its section, refused by its presence before this schema is used (SL1 to SL5). */
const later = z.unknown().optional()

const SourceSchema = z.strictObject(
  {
    image: checkedString("SV8", isImage, "SV7"),
    build: later,
  },
  { error: (issue) => (issue.input === undefined ? "SV7" : "SV5") }
)

const DeploySchema = z.strictObject(
  {
    start: z
      .string(fails("SV9:type"))
      .superRefine((start, context) => {
        const problem = startProblem(start)
        if (problem !== undefined)
          context.addIssue({ code: "custom", message: `SV9:${problem}` })
      })
      .optional(),
    restart: checkedString(
      "SV10",
      (restart) => !checkRestart(restart)
    ).optional(),
    memory: checkedString("SV11", (memory) => !checkMemory(memory)).optional(),
    cpus: checkedNumber("SV12", checkCpus).optional(),
    predeploy: later,
    healthcheck: later,
    replicas: later,
  },
  fails("SV5")
)

const NetworkingSchema = z.strictObject(
  {
    port: checkedNumber("SV13", checkPort).optional(),
    publish: checkedNumber("SV14", checkPort).optional(),
    domains: later,
  },
  fails("SV5")
)

const SecretsSchema = z
  .array(
    z.string(fails("SV17")).superRefine((name, context) => {
      const problem = secretNameProblem(name)
      if (problem !== undefined)
        context.addIssue({
          code: "custom",
          message: problem === "form" ? "SV18" : "SV19",
        })
    }),
    fails("SV17")
  )
  .refine((names) => names.length <= MAX_SECRETS, counted("SV21", isList))
  .superRefine((names, context) => {
    const seen = new Set<string>()
    for (const [index, name] of names.entries()) {
      if (seen.has(name)) {
        context.addIssue({ code: "custom", message: "SV20", path: [index] })
        return
      }
      seen.add(name)
    }
  })

const PlainSchema = z
  .map(
    z.string().refine((name) => !checkPlainName(name), fails("SV23")),
    checkedString("SV24", (value) => !checkPlainValue(value)),
    fails("SV22")
  )
  .refine((plain) => plain.size <= MAX_PLAIN, counted("SV26", isMap))

const VariablesSchema = z.strictObject(
  {
    secrets: SecretsSchema.optional(),
    plain: PlainSchema.optional(),
  },
  fails("SV5")
)

const VolumesSchema = z
  .map(
    z.string().refine((name) => !checkVolumeName(name), fails("SV28")),
    checkedString("SV29", (path) => !checkMountPath(path)),
    fails("SV27")
  )
  .refine((volumes) => volumes.size <= MAX_VOLUMES, counted("SV31", isMap))

export const ServiceSchema = z.strictObject(
  {
    source: SourceSchema,
    deploy: DeploySchema.optional(),
    networking: NetworkingSchema.optional(),
    variables: VariablesSchema.optional(),
    volumes: VolumesSchema.optional(),
  },
  fails("SV5")
)

const ServicesSchema = z
  .map(
    z.string().refine((name) => !checkServiceName(name), fails("SV4")),
    ServiceSchema,
    fails("SV2")
  )
  .refine((services) => services.size > 0, counted("SV2", isMap))
  .refine((services) => services.size <= MAX_SERVICES, counted("SV3", isMap))

/** The whole file. `zekno` is checked before this schema is used (SV1, SL0). */
export const SettingsSchema = z.strictObject({
  zekno: z.unknown(),
  services: ServicesSchema,
})

/**
 * The keys each section knows, read from its schema, by the section's name in
 * a service. Maps, and `has` for a schema's shape: a key of the file such as
 * `constructor` or `toString` must never be found on a prototype.
 */
export const SECTIONS: ReadonlyMap<string, object> = new Map<string, object>([
  ["source", SourceSchema.shape],
  ["deploy", DeploySchema.shape],
  ["networking", NetworkingSchema.shape],
  ["variables", VariablesSchema.shape],
])

/** The later settings, by section: the only places they may come (design.md, "The file"). */
export const LATER: ReadonlyMap<
  string,
  ReadonlyMap<string, LaterSetting>
> = new Map([
  ["source", new Map([["build", "build"]])],
  [
    "deploy",
    new Map<string, LaterSetting>([
      ["predeploy", "predeploy"],
      ["healthcheck", "healthcheck"],
      ["replicas", "replicas"],
    ]),
  ],
  ["networking", new Map([["domains", "domains"]])],
])

/** Whether `key` is an own key of `object`: never one its prototype has. */
export const has = (object: object, key: string): boolean =>
  Object.hasOwn(object, key)

/** One service as the schema gives it. */
export type ParsedService = z.output<typeof ServiceSchema>
