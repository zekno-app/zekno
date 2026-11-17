/**
 * The shape of a template file's own fields (specs/012-templates,
 * contracts/template-file.md, "The format"), declared with zod
 * `strictObject`s and maps as feature 010's settings/shape.ts declares the
 * sections of a settings file. `services` is not declared here: it is held
 * to the settings file's own rules (settings/schema.ts,
 * `checkSettingsValue`). read.ts gives this shape the file and turns what it
 * says into the contract's sentences.
 *
 * Each issue carries the id of its sentence as its message (`TF5` to
 * `TF20`), never a piece of the file: read.ts builds the place from the id
 * and the issue's path, and puts a name into it only once the name passed
 * its rule.
 */
import { isReservedSecretName } from "@workspace/core"
import { z } from "zod"

import { JsonNumber } from "../settings/shape"

/** A template's name, and each of its other names (`also`): what a person types. */
export const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,31}$/
/** A made or offered secret's name: capital letters, so `{service}` can never name one. */
export const MADE_NAME = /^[A-Z][A-Z0-9_]{0,127}$/
/** The most bytes a template file may hold (TR2). */
export const TEMPLATE_BYTES = 16_384
/** The most services a template may hold (TF13). */
export const MAX_SERVICES = 8
/** The least and the most secrets a template makes (TF14), and their length (TF16). */
export const MAX_MAKES = 16
export const PASSWORD_LENGTH = { least: 24, most: 64 } as const
/** The most connection secrets a template offers (TF17), and the most characters of one (TF19). */
export const MAX_OFFERS = 4
export const MAX_OFFER = 512
/** The most notes (TF20), other names (TF12), and characters of a note (TF20). */
export const MAX_NOTES = 8
export const MAX_ALSO = 8
export const MAX_NOTE = 200

/** An offer's text as written: allowed characters, and placeholders in braces (TF19). Which placeholders is TF28's. */
export const OFFER_TEXT = /^(?:[A-Za-z0-9:/@?&=._%+~-]|\{[A-Za-z0-9_]+\})+$/

/** A made or offered secret's name: capital letters, digits and underscore, at most 128, not one zekno keeps for itself. */
export const isMadeName = (name: string): boolean =>
  MADE_NAME.test(name) && !isReservedSecretName(name)

/** Printable ASCII, a space to a tilde. */
const PRINTABLE = /^[\x20-\x7e]*$/

/** The id of a sentence, as zod's message: `TF5` for a field left out, `wrong` for a field of the wrong form. */
const fails = (id: string) => ({ error: id })
const missingOr = (wrong: string) => ({
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? "TF5" : wrong,
})

/** A required string held to `check`; TF5 when it is left out. */
const field = (wrong: string, check: (text: string) => boolean) =>
  z.string(missingOr(wrong)).refine(check, fails(wrong))

/**
 * A count is checked whenever its list or object is one, even when an entry
 * is wrong: it is at the place of its list or object, so it is said before a
 * fault of one of its entries (as settings/shape.ts says a count).
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

/** A note: a sentence of printable ASCII, at most 200 characters, ending with a full stop (TF20). */
const isNote = (note: string): boolean =>
  note.length <= MAX_NOTE && PRINTABLE.test(note) && note.endsWith(".")

/** A made secret: `{ "kind": "password", "length": <24 to 64> }` (TF16). */
const MadeSchema = z.strictObject(
  {
    kind: z.literal("password", fails("TF16")),
    length: z
      .custom<JsonNumber>((value) => value instanceof JsonNumber, fails("TF16"))
      .refine(
        (number) =>
          /^[1-9][0-9]*$/.test(number.text) &&
          number.value >= PASSWORD_LENGTH.least &&
          number.value <= PASSWORD_LENGTH.most,
        fails("TF16")
      ),
  },
  fails("TF16")
)

/** `makes`: 1 to 16 names (TF14), each a made secret's name (TF15) and a made secret (TF16). */
const MakesSchema = z
  .map(
    z.string().refine(isMadeName, fails("TF15")),
    MadeSchema,
    missingOr("TF14")
  )
  .refine(
    (makes) => makes.size >= 1 && makes.size <= MAX_MAKES,
    counted("TF14", isMap)
  )

/** `offers`: at most 4 names (TF17), each a secret's name (TF18) and an offer's text (TF19). */
const OffersSchema = z
  .map(
    z.string().refine(isMadeName, fails("TF18")),
    z
      .string(fails("TF19"))
      .refine(
        (text) => text.length <= MAX_OFFER && OFFER_TEXT.test(text),
        fails("TF19")
      ),
    fails("TF17")
  )
  .refine((offers) => offers.size <= MAX_OFFERS, counted("TF17", isMap))

/**
 * The fields of a template file but `template` (checked first, TF1 and TF2)
 * and `services` (held to the settings rules), for the file `name` (the file's
 * own name without `.json`, which `name` must be, TF7, and `also` must not
 * hold, TF12). The keys are in the order of the format, so of the fields left
 * out the first by the format is said first. `asks` and any key not known
 * are refused before this shape is used (TF3, TF4).
 */
export function fieldsShape(name: string) {
  return z.strictObject({
    template: z.unknown(),
    name: z
      .string(missingOr("TF6"))
      .refine((given) => TEMPLATE_NAME.test(given), fails("TF6"))
      .refine((given) => given === name, fails("TF7")),
    title: field("TF8", (title) => /^[A-Za-z0-9 .+-]{1,40}$/.test(title)),
    about: field(
      "TF9",
      (about) =>
        about.length <= 80 && PRINTABLE.test(about) && about.endsWith(".")
    ),
    software: field("TF10", (software) =>
      /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(software)
    ),
    author: field("TF11", (author) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(author)
    ),
    also: z
      .array(
        z
          .string(fails("TF12"))
          .refine(
            (other) => TEMPLATE_NAME.test(other) && other !== name,
            fails("TF12")
          ),
        fails("TF12")
      )
      .refine((also) => also.length <= MAX_ALSO, counted("TF12", isList))
      .refine(
        (also) => new Set(also).size === also.length,
        counted("TF12", isList)
      )
      .optional(),
    // Held to the settings rules after this shape; here only whether it is there (TF5).
    services: z.custom((value) => value !== undefined, fails("TF5")),
    makes: MakesSchema,
    offers: OffersSchema.optional(),
    notes: z
      .array(
        z.string(fails("TF20")).refine(isNote, fails("TF20")),
        missingOr("TF20")
      )
      .refine(
        (notes) => notes.length >= 1 && notes.length <= MAX_NOTES,
        counted("TF20", isList)
      ),
  })
}

/** What the shape gives for a file's fields. */
export type ParsedFields = z.output<ReturnType<typeof fieldsShape>>
