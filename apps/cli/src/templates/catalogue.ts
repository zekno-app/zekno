/**
 * The templates this zekno carries (specs/012-templates, research R1;
 * contracts/template-file.md, "Where a template comes from", "The index" and
 * "The first set"; plan.md, D8).
 *
 * Templates come only from the texts the CLI was built with: the files the
 * index (files/index.ts) names, each taken as its text when the CLI is
 * built or run from source. Nothing reads a template from the folder the
 * command runs in, the profile folder, a path given on the command line, or
 * the network (FR-001). Each text is read by the strict reader all the same
 * (read.ts), once per run, and checked across the others (TC1, TC2): a
 * released zekno never fails here, since its tests read every file, and if
 * one did it would say AD27 and add nothing. A file that asks a question
 * when it is added (TF4) is no fault of this zekno's but a template of a
 * later one: it is left out of the catalogue and named by `askingTemplates`,
 * so that naming it says AD28 (plan.md, D20).
 */
import { CliError } from "../cli/errors"
import { sanitize } from "../server/sanitize"
import { AD27 } from "./add-words"
import { TF4 } from "./file-words"
import { TEMPLATE_FILES } from "./files/index"
import {
  acrossTemplates,
  isTemplate,
  readTemplate,
  templateNameOf,
} from "./read"
import type { Catalogue, Template, TemplateFault } from "./types"

/** A line's import as its text; anything else is the empty text, which never reads, so it is AD27 at the catalogue's first read. */
function textOf(imported: unknown): string {
  const given: unknown =
    typeof imported === "object" && imported !== null
      ? (imported as { default?: unknown }).default
      : undefined
  return typeof given === "string" ? given : ""
}

/** Each template file the index names, as `<name>.json` and its text, in the index's order: the order of the names. */
export const TEMPLATE_TEXTS: readonly (readonly [
  file: string,
  text: string,
])[] = TEMPLATE_FILES.map(
  ([name, imported]) => [`${name}.json`, textOf(imported)] as const
)

/** The first set, in the boards' order; every other template comes after them, by name (D8). */
export const FIRST = ["postgres", "mysql", "mongodb", "redis"] as const

/** The place of a template in the catalogue's order. */
function byOrder(a: Template, b: Template): number {
  const first = (name: string): number => {
    const at = (FIRST as readonly string[]).indexOf(name)
    return at === -1 ? FIRST.length : at
  }
  return (
    first(a.name) - first(b.name) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
}

/** Whether a read is the fault of a template that asks a question when it is added (TF4). */
const asks = (file: string, read: Template | TemplateFault): boolean => {
  const name = templateNameOf(file)
  return (
    name !== undefined &&
    !isTemplate(read) &&
    read.kind === "later" &&
    read.first === TF4(name).first
  )
}

/** Each catalogue read, by the texts it was read from: read once per run. */
const kept = new WeakMap<
  object,
  { templates: Catalogue; asking: readonly string[] }
>()

/** The templates of `texts`, and the names of those that ask (TF4); AD27 for any other fault, or a clash. */
function readAll(texts: readonly (readonly [file: string, text: string])[]): {
  templates: Catalogue
  asking: readonly string[]
} {
  const known = kept.get(texts)
  if (known !== undefined) return known
  const templates: Template[] = []
  const asking: string[] = []
  for (const [file, text] of texts) {
    const read = readTemplate(file, text)
    if (isTemplate(read)) templates.push(read)
    else if (asks(file, read)) asking.push(templateNameOf(file)!)
    else throw new CliError(AD27(templateNameOf(file) ?? sanitize(file)))
  }
  const clash = acrossTemplates(templates)
  if (clash !== undefined) throw new CliError(AD27(clash.name))
  const read = { templates: [...templates].sort(byOrder), asking }
  kept.set(texts, read)
  return read
}

/**
 * The templates of `texts` (the ones this zekno was built with, unless a
 * test gives others), each read and checked, checked across one another in
 * the order given, and in the catalogue's order (D8). Read once for the same
 * texts. A template that does not pass is a `CliError` with AD27, naming it.
 */
export function catalogue(
  texts: readonly (readonly [file: string, text: string])[] = TEMPLATE_TEXTS
): Catalogue {
  return readAll(texts).templates
}

/**
 * The names of the templates of `texts` that ask a question when they are
 * added (TF4): this zekno does not ask template questions yet, so naming
 * one is AD28 (D20). Read with the catalogue, once.
 */
export function askingTemplates(
  texts: readonly (readonly [file: string, text: string])[] = TEMPLATE_TEXTS
): readonly string[] {
  return readAll(texts).asking
}

/**
 * The template a person named: the one of that name, or `{ also }` naming
 * the template whose other names hold it (AL3), or undefined.
 */
export function findTemplate(
  name: string,
  list: Catalogue = catalogue()
): Template | { also: string } | undefined {
  const named = list.find((template) => template.name === name)
  if (named !== undefined) return named
  const other = list.find((template) => template.also.includes(name))
  return other === undefined ? undefined : { also: other.name }
}
