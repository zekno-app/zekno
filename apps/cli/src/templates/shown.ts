/**
 * What `zekno add` shows of a template (specs/012-templates, data-model.md,
 * "What is shown"; contracts/commands.md, "a settings file, at a terminal";
 * board `AddTemplate`): the summary of an addition before the question
 * (plan.md, D24, D26, D30, D31, D32).
 *
 * Everything here is made of names that passed their rule (the template's,
 * the file's, the app's and the server's) and fixed words. A made value never
 * reaches it: a connection secret is shown by `shownOffer`, `••••` in place
 * of each made value (research R6). A start command is not in the summary
 * (D26): `--show` has it.
 */
import { DP3 } from "../settings/words"
import { SUMMARY } from "./add-words"
import { shownOffer } from "./made"
import type { Addition, AdditionReport, Offer } from "./types"

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
