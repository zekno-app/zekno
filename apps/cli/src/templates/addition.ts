/**
 * What adding a template to a settings file would do (specs/012-templates,
 * data-model.md, "An addition"; contracts/commands.md, "The order of
 * checks", steps 9 to 12; research R5): pure, with no file, no team, no
 * clock and no random value. Nothing that exists is replaced: a service, a
 * volume or a variable of that name already in the file is refused with its
 * sentence (FR-009).
 *
 * The template's services are added last, the first under `--name` when it
 * is given, each volume named `<service>-<volume>` in the app so no two
 * services share one (D1). Each connection secret is read by the services of
 * the file chosen for it (`--for`, the one other service, or a question),
 * which gain its name last in their secrets, and by no other: a service of
 * the file that already lists a name the template stores is refused (AD29),
 * so the summary's "read by" is what the Compose text gives (security review
 * T1). The settings with the services added are read back as a settings file
 * is read, so the file zekno writes is one its reader reads (AD15
 * otherwise).
 */
import { checkSettings, isSettings } from "../settings/schema"
import { settingsText } from "../settings/text"
import type {
  ServiceSettings,
  Settings,
  SettingsFault,
} from "../settings/types"
import { checkServiceName, SETTINGS_BYTES } from "../settings/values"
import { laterSentences } from "../settings/words"
import * as words from "./add-words"
import type {
  Addition,
  AdditionRefused,
  ReadersQuestion,
  Template,
} from "./types"

/** What an addition is planned from. */
export type AdditionInput = {
  template: Template
  /** The settings file's settings, as read. */
  settings: Settings
  /** The settings file as a sentence names it. */
  file: string
  /** `--name`: the name of the template's first service in the app. */
  name?: string
  /**
   * Who reads the connection secrets: `--for`, the same services for each;
   * or the answers to the question, by connection secret. Undefined: decide
   * from the file, or ask.
   */
  readers?: readonly string[] | ReadonlyMap<string, readonly string[]>
}

/** Whether readers are one list for every connection secret (`--for`), not the answers by connection secret. */
const isList = (
  readers: readonly string[] | ReadonlyMap<string, readonly string[]>
): readers is readonly string[] => Array.isArray(readers)

const refuse = (
  id: AdditionRefused["id"],
  sentence: string
): AdditionRefused => ({ id, sentence, status: 2 })

/** The template's services as they go into the app: the first under `name`, each volume `<service>-<volume>`. `--show` shows them so, with no name (D1). */
export function servicesInApp(
  template: Template,
  name: string | undefined
): (readonly [string, ServiceSettings])[] {
  return template.services.map(([own, service], index) => {
    const named = index === 0 ? (name ?? own) : own
    const volumes = service.volumes?.map(
      ([volume, path]) => [`${named}-${volume}`, path] as const
    )
    return [named, volumes === undefined ? service : { ...service, volumes }]
  })
}

/** The place and rule of a settings fault, for AD15's second sentence. */
function broken(
  fault: SettingsFault,
  file: string
): { place: string; rule: string } {
  switch (fault.kind) {
    case "form":
      return { place: fault.place, rule: fault.rule }
    case "later":
      return {
        place: "",
        rule: laterSentences(file, fault.setting, fault.service).join(" "),
      }
    case "read":
      return { place: "", rule: fault.sentence }
  }
}

/**
 * The addition of `input.template` to `input.settings`, or the first refusal
 * by contracts/commands.md, "The order of checks" (AU9, AD6, AD9, AD14, AD29,
 * AD7, AD15; each status 2), or the connection secrets whose readers a person
 * must choose: with no `readers`, when the file has several services.
 */
export function planAddition(
  input: AdditionInput
): Addition | AdditionRefused | ReadersQuestion {
  const { template, settings, file } = input
  if (input.name !== undefined && template.services.length > 1)
    return refuse("AU9", words.AU9(template.name))
  const services = servicesInApp(template, input.name)
  const service = services[0]![0]
  const inFile = settings.services.map(([name]) => name)

  // 9. The service's name in the app, then each volume.
  for (const [name] of services)
    if (inFile.includes(name)) return refuse("AD6", words.AD6(file, name))
  const volumes = new Set(
    settings.services.flatMap(([, each]) =>
      (each.volumes ?? []).map(([volume]) => volume)
    )
  )
  for (const [, each] of services)
    for (const [volume] of each.volumes ?? [])
      if (volumes.has(volume)) return refuse("AD9", words.AD9(file, volume))

  // 10. Who reads each connection secret: those named, the one other service, or a question.
  const given = input.readers
  const named = (offer: string): readonly string[] =>
    given === undefined ? [] : isList(given) ? given : (given.get(offer) ?? [])
  for (const reader of template.offers.flatMap((offer) => named(offer.name)))
    if (!inFile.includes(reader))
      return refuse(
        "AD14",
        words.AD14(
          file,
          checkServiceName(reader) === undefined ? reader : undefined,
          inFile
        )
      )
  if (given === undefined && template.offers.length > 0 && inFile.length > 1)
    return {
      ask: template.offers.map((offer) => ({
        offer: offer.name,
        services: inFile,
      })),
    }
  const readBy = template.offers.map((offer) => ({
    offer: offer.name,
    services:
      given === undefined
        ? inFile
        : inFile.filter((name) => named(offer.name).includes(name)),
  }))

  // 11. No service of the file lists a name the template stores in its secrets: secrets are the app's, and the Compose
  // text gives a service every secret its `secrets` lists, so it would read the new one unnamed by the summary (security
  // review T1). Then no reader has a plain variable of the connection secret's name, which the secret would replace.
  const stored = [
    ...template.makes.map((made) => made.name),
    ...template.offers.map((offer) => offer.name),
  ]
  for (const [name, each] of settings.services) {
    const listed = stored.find((secret) => each.secrets?.includes(secret))
    if (listed !== undefined) return refuse("AD29", words.AD29(name, listed))
  }
  for (const { offer, services: reading } of readBy)
    for (const reader of reading) {
      const [, each] = settings.services.find(([name]) => name === reader)!
      if (each.plain?.some(([variable]) => variable === offer))
        return refuse("AD7", words.AD7(reader, offer))
    }

  // 12. The settings with the services added, read back as the reader reads a file.
  const next: Settings = {
    version: 1,
    services: [
      ...settings.services.map(([name, each]) => {
        const gains = readBy
          .filter(({ services: reading }) => reading.includes(name))
          .map(({ offer }) => offer)
        return gains.length === 0
          ? ([name, each] as const)
          : ([
              name,
              { ...each, secrets: [...(each.secrets ?? []), ...gains] },
            ] as const)
      }),
      ...services,
    ],
  }
  const text = settingsText(next)
  if (Buffer.byteLength(text) > SETTINGS_BYTES)
    return refuse("AD15", words.AD15(service, file, "size"))
  const back = checkSettings(text, file)
  if (!isSettings(back))
    return refuse("AD15", words.AD15(service, file, broken(back, file)))
  return { template, service, services, readers: readBy, settings: next }
}
