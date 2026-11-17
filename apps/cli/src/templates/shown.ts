/**
 * What `zekno add` shows of a template (specs/012-templates, data-model.md,
 * "What is shown"; contracts/commands.md, "a settings file, at a terminal",
 * "`zekno add --list`" and "`zekno add <template> --show`"; boards
 * `AddTemplate` and `AddLook`): the summary of an addition before the
 * question, the rows of the list and the picker, and what `--show` shows,
 * at a terminal, piped and as JSON (plan.md, D18, D24, D25, D26, D30, D31,
 * D32).
 *
 * Everything here is made of names that passed their rule (the template's,
 * the file's, the app's and the server's) and fixed words. A made value never
 * reaches it: a connection secret is shown by `shownOffer`, `••••` in place
 * of each made value (research R6). A start command is not in the summary
 * (D26): `--show` has it.
 */
import { pipedLines } from "../settings/piped"
import { reportOf } from "../settings/rows"
import { settingsText } from "../settings/text"
import type { SettingRow, Settings } from "../settings/types"
import { DP3 } from "../settings/words"
import { AV3, AV4, SUMMARY } from "./add-words"
import { servicesInApp } from "./addition"
import { shownOffer } from "./made"
import { BACKUP_NOTE } from "./read"
import type {
  Addition,
  AdditionReport,
  Catalogue,
  Offer,
  Template,
  TemplateRow,
  TemplateView,
} from "./types"

/** An image as the summary names it: without its digest (`postgres:18.7`). The digest is said by `pinned by digest`. */
const withoutDigest = (image: string): string => image.split("@")[0]!

/** The made secrets an offer is built from, each once. */
function madeIn(offer: Offer, made: readonly string[]): Set<string> {
  const names = [...offer.text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
    (found) => found[1]!
  )
  return new Set(names.filter((name) => made.includes(name)))
}

/** What the summary is made from: the addition, and where it goes. */
export type ReportInput = {
  addition: Addition
  app: string
  /** The server's name, and where it is: `deploy@203.0.113.7` or `this machine`, already cleaned. */
  server: { name: string; where: string }
  /** The settings file as a sentence names it. */
  file: string
  /** The file's services as they are now, in its order. */
  services: readonly string[]
}

/**
 * The summary of an addition before the question (board `AddTemplate`, left
 * column): the template, the app, the server and the file; each service as
 * it goes into the file; each made secret and who reads it; each connection
 * secret with `••••` in place of its made values, and who reads it; the
 * template's notes.
 */
export function additionReport(input: ReportInput): AdditionReport {
  const { addition, app, server, file } = input
  const { template, service } = addition
  const made = template.makes.map((secret) => secret.name)
  return {
    title: template.title,
    software: template.software,
    about: template.about,
    author: template.author,
    app,
    server,
    file: { shown: file, detail: DP3.detail(input.services) },
    services: addition.services.map(([name, each]) => ({
      name,
      image: withoutDigest(each.image),
      ...(each.restart === undefined
        ? {}
        : { rule: SUMMARY.restart(each.restart) }),
      ...(each.port === undefined ? {} : { port: SUMMARY.port(each.port) }),
      volumes: (each.volumes ?? []).map(([volume]) => volume),
    })),
    made: template.makes.map((secret) => ({
      name: secret.name,
      length: secret.length,
      readBy: addition.services
        .filter(([, each]) => each.secrets?.includes(secret.name))
        .map(([name]) => name),
    })),
    offers: template.offers.map((offer) => ({
      name: offer.name,
      pieces: shownOffer(offer, service),
      usesSeveral: madeIn(offer, made).size > 1,
      readBy:
        addition.readers.find((readers) => readers.offer === offer.name)
          ?.services ?? [],
    })),
    notes: template.notes,
  }
}

/** A template's about as the list and the picker show it: without its full stop (D24). */
const withoutStop = (about: string): string => about.replace(/\.$/, "")

/** The rows of `zekno add --list` and of the picker, in the catalogue's order (D8): names and words that passed their rules. */
export function templateRows(list: Catalogue): TemplateRow[] {
  return list.map((template) => ({
    name: template.name,
    title: template.title,
    software: template.software,
    about: withoutStop(template.about),
    author: template.author,
  }))
}

/** `zekno add --list --json` (D18): one object, each template's fields in the contract's order, the about whole. */
export function listObject(list: Catalogue) {
  return {
    templates: list.map((template) => ({
      name: template.name,
      title: template.title,
      about: template.about,
      software: template.software,
      author: template.author,
      also: template.also,
    })),
  }
}

/** A service's rows with its plain variables on one row, `plain`, joined with `, ` (contracts/commands.md, `--show`). */
function plainOnOneRow(rows: readonly SettingRow[]): SettingRow[] {
  const plain = rows.filter((row) => row.path.key === "plain")
  if (plain.length === 0) return [...rows]
  const at = rows.indexOf(plain[0]!)
  return [
    ...rows.slice(0, at),
    {
      ...plain[0]!,
      label: "plain",
      shown: plain.map((row) => row.shown).join(", "),
    },
    ...rows.slice(at + 1).filter((row) => row.path.key !== "plain"),
  ]
}

/**
 * What `zekno add <template> --show` shows (board `AddLook`, middle column):
 * the title line; each service as it would be added under its own name, in
 * the rows of `zekno settings`, the image whole with its digest (D25), the
 * plain variables on one row, a start command in Deploy; the made and the
 * connection secrets; Good to know: AV3 when a service keeps data in a
 * volume, AV4, then the template's other notes, the backup note said once
 * (D24); and the lines plain output prints, the placeholders as written.
 */
export function templateView(template: Template): TemplateView {
  const settings: Settings = {
    version: 1,
    services: servicesInApp(template, undefined),
  }
  const made = template.makes.map((secret) => secret.name)
  const kept = settings.services.some(
    ([, service]) => (service.volumes ?? []).length > 0
  )
  return {
    title: template.title,
    software: template.software,
    about: template.about,
    author: template.author,
    services: reportOf(settings).services.map((service) => ({
      name: service.name,
      rows: plainOnOneRow(service.rows),
    })),
    made: template.makes.map(({ name, length }) => ({ name, length })),
    offers: template.offers.map((offer) => ({
      name: offer.name,
      usesSeveral: madeIn(offer, made).size > 1,
    })),
    good: [
      ...(kept ? [AV3] : []),
      AV4,
      ...template.notes.filter((note) => !(kept && note === BACKUP_NOTE)),
    ],
    piped: [
      ...pipedLines(settings),
      ...template.makes.map(
        (secret) => ["made", secret.name, String(secret.length)] as const
      ),
      ...template.offers.map(
        (offer) => ["built", offer.name, offer.text] as const
      ),
    ],
  }
}

/**
 * `zekno add <template> --show --json` (D18): the template's data as read,
 * its keys in the order of contracts/template-file.md, "The format", and each
 * service's keys in the order `zekno settings --json` writes them (the text
 * zekno writes for a settings file).
 */
export function templateObject(template: Template) {
  const { services } = JSON.parse(
    settingsText({ version: 1, services: template.services })
  ) as { services: unknown }
  return {
    template: 1,
    name: template.name,
    title: template.title,
    about: template.about,
    software: template.software,
    author: template.author,
    also: template.also,
    services,
    makes: Object.fromEntries(
      template.makes.map(({ name, kind, length }) => [name, { kind, length }])
    ),
    offers: Object.fromEntries(
      template.offers.map(({ name, text }) => [name, text])
    ),
    notes: template.notes,
  }
}
