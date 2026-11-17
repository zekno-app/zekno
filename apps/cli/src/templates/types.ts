/**
 * The types of templates (specs/012-templates, data-model.md): a template
 * file as read, a fault in one, the catalogue, an addition to a settings
 * file, and what is shown of each. Types only: the reader, the catalogue,
 * the made values, the addition and what is shown are the other files of
 * this folder. Nothing here holds a made secret's value: the types that
 * leave a function name secrets, never their values (research R6).
 */
import type { ServiceSettings, SettingRow, Settings } from "../settings/types"

/** A secret a template makes at random on the user's machine. */
export type MadeSecret = {
  name: string
  /** The only kind in this version: letters and digits. */
  kind: "password"
  /** 24 to 64. */
  length: number
}

/** A connection secret a template offers to the app's own services. */
export type Offer = {
  name: string
  /** As the file writes it: `{service}` and `{MADE}` placeholders, the rest fixed text. */
  text: string
}

/** One template file, read and checked whole. Lists keep the file's order. */
export type Template = {
  name: string
  title: string
  about: string
  software: string
  author: string
  also: readonly string[]
  /** The services as feature 010's reader gives them: `Settings["services"]`. */
  services: Settings["services"]
  makes: readonly MadeSecret[]
  offers: readonly Offer[]
  notes: readonly string[]
}

/** Why a template file cannot be used, as the sentences say it. Never a piece of its content. */
export type TemplateFault =
  /** `<name> <place>: <rule>` (TR, TF, TS, TC). */
  | { kind: "form"; place: string; rule: string; line?: number }
  /** Two sentences: a later version (TF2) or a question (TF4). */
  | { kind: "later"; first: string; second: string }

/** The templates this zekno carries, in their order (contracts/template-file.md, "The first set"). */
export type Catalogue = readonly Template[]

/** What one run of `zekno add` would do to a settings file, before anything is written. Pure data: no file, no secret value. */
export type Addition = {
  template: Template
  /** The name the template's first service gets in the app: its own, or `--name`. */
  service: string
  /** The template's services as they go into the file: the first renamed, each volume `<service>-<vol>`. */
  services: readonly (readonly [name: string, service: ServiceSettings])[]
  /** For each connection secret, the services of the file that read it, in the file's order. */
  readers: readonly { offer: string; services: readonly string[] }[]
  /** The file's settings with the services added last and each reader's `secrets` gaining its connection secret. */
  settings: Settings
}

/** Why an addition cannot be made: the sentence's id and its words. */
export type AdditionRefused = {
  id: "AD6" | "AD7" | "AD9" | "AD14" | "AD15" | "AD29" | "AU9"
  sentence: string
  status: 2
}

/** The connection secrets whose readers a person has to choose, each with the services to choose from (AD10). */
export type ReadersQuestion = {
  ask: readonly { offer: string; services: readonly string[] }[]
}

/** One row of `zekno add --list` and of the picker. */
export type TemplateRow = {
  name: string
  title: string
  software: string
  about: string
  author: string
}

/** The summary before the question (board `AddTemplate`). Every value is a name that passed its rule or fixed words. */
export type AdditionReport = {
  title: string
  software: string
  about: string
  author: string
  app: string
  server: { name: string; where: string }
  file: { shown: string; detail: string }
  services: readonly {
    name: string
    /** The image without its digest. */
    image: string
    /** `restart always · port 5432, not published` pieces, or none. */
    rule?: string
    port?: string
    volumes: readonly string[]
  }[]
  made: readonly { name: string; length: number; readBy: readonly string[] }[]
  offers: readonly {
    name: string
    pieces: readonly { text: string; hidden: boolean }[]
    /** Built from more than one made secret: `Builds a secret from them`. */
    usesSeveral: boolean
    readBy: readonly string[]
  }[]
  notes: readonly string[]
}

/** What one run of `zekno add` did, for the result lines and the plain lines (AD16, AD17, AD23). Names and versions only. */
export type AddDone = {
  /** The template's first service, by its name in the app. */
  service: string
  /** The settings file written, as a sentence names it; left out when none was (a hand-written Compose file). */
  file?: string
  /** Each secret stored and the version it got: the made secrets, then the connection secrets, in the template's order. */
  stored: readonly { name: string; version: number }[]
  /** The server the secrets were sealed for. */
  server: string
}

/** `zekno add <template> --show` (board `AddLook`). */
export type TemplateView = {
  title: string
  software: string
  about: string
  author: string
  /** Per service, the rows of feature 010's report, with the plain values on one row. */
  services: readonly { name: string; rows: readonly SettingRow[] }[]
  made: readonly { name: string; length: number }[]
  offers: readonly { name: string; usesSeveral: boolean }[]
  /** AV3 when a volume is kept, AV4, then the other notes. */
  good: readonly string[]
  /** What plain output prints (contracts/commands.md, "--show", piped). */
  piped: readonly (readonly [string, string, string])[]
}

/** The lines for a hand-written Compose file (board `AddOther`). */
export type HandLines = {
  file: string
  service: readonly string[]
  volumes: readonly string[]
  offers: readonly string[]
}
