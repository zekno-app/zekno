/**
 * The types of an app's settings file, `zekno.app.json`
 * (specs/010-app-settings, data-model.md): the settings as read, a fault in
 * the file, a change of one setting, what is shown, and which file a deploy
 * uses. Types only: the reader, the writer and the Compose text are the other
 * files of this folder.
 */
import type { ComposeSource, ComposeText } from "../project/compose-read"

/** One service's settings, as the file holds them. Absent: not set. */
export type ServiceSettings = {
  image: string
  start?: string
  restart?: "no" | "on-failure" | "always"
  memory?: string
  /** As written in the file, held to research R1's form: "1", "0.5". */
  cpus?: string
  port?: number
  publish?: number
  secrets?: readonly string[]
  plain?: readonly (readonly [name: string, value: string])[]
  volumes?: readonly (readonly [name: string, path: string])[]
}

/** The whole file, read and checked. Services, plain variables and volumes in the file's order. */
export type Settings = {
  version: 1
  services: readonly (readonly [name: string, service: ServiceSettings])[]
}

/** A file as it was read from the disk: what a later write compares against. */
export type SettingsRead = {
  /** The file's path, as the reader opened it (a real path for one inside a folder). */
  path: string
  /** As a sentence names it: relative to the folder the command runs in when inside it. */
  shown: string
  /** The SHA-256 of the bytes read, as lowercase hex. */
  sha256: string
  /** The file's identity and mode, from the descriptor it was read from. */
  dev: number
  ino: number
  mode: number
  settings: Settings
}

/** A setting a later version of zekno brings: refused by its presence (SL0 to SL5). `version` is the file's own `zekno`. */
export type LaterSetting =
  "version" | "build" | "predeploy" | "healthcheck" | "replicas" | "domains"

/** Why the file could not be used, as the sentences say it. Never a piece of the file's content. */
export type SettingsFault =
  /** The bytes could not be read (SR1 to SR9). */
  | { kind: "read"; sentence: string }
  /** Not settings this zekno reads (SJ1 to SJ5, SV1 to SV33): where, and the rule. An empty place: the rule is said alone. */
  | { kind: "form"; place: string; rule: string; line?: number }
  /** A setting a later version brings (SL0 to SL5): what it sets, for which service. */
  | { kind: "later"; setting: LaterSetting; service?: string }

/** One setting of one service, as `zekno settings set` and the screen name it. */
export type SettingPath =
  | {
      service: string
      key:
        | "image"
        | "start"
        | "restart"
        | "memory"
        | "cpus"
        | "port"
        | "publish"
        | "secrets"
    }
  | { service: string; key: "plain"; name: string }
  | { service: string; key: "volume"; name: string }

/** What `set` or `unset` asks for, before anything is written. `value` undefined: unset. */
export type Change = {
  path: SettingPath
  /** The setting's words for a person: "memory limit", "start command", "volume uploads". */
  label: string
  /** As a person reads them: "512m", "no limit", "on failure". */
  now: string
  next: string
  value?: string | number | readonly string[]
  /** The settings with the change made, read back as a check (research R5). */
  settings: Settings
}

/** One row of a service's settings, for `zekno settings` and the screen. */
export type SettingRow = {
  section: "Source" | "Deploy" | "Networking" | "Variables" | "Volumes"
  /** The row's label: "image", "memory", "published", "plain", a volume's name. Empty on a second plain row. */
  label: string
  /** The setting the row changes; a `none` row of plain or volumes adds one. */
  path: SettingPath | { service: string; key: "plain" | "volume"; adding: true }
  /** What a person reads, cleaned; `set` false when it is the words of a setting left out. */
  shown: string
  set: boolean
  /** Changed since this machine's last deploy, with the old value when there was one. */
  changed?: { was?: string }
}

/** What `zekno settings` shows. */
export type SettingsReport = {
  /** The app, when this folder's zekno.json names it and is in use here. */
  app?: string
  file: string
  services: readonly { name: string; rows: readonly SettingRow[] }[]
  /** SH3, when this folder's zekno.json names a Compose file instead. */
  note?: string
}

/** What a deploy reads, whichever kind of file it came from. */
export type DeployText = ComposeText & {
  /** Set for a settings file: its services, for the summary's `from` line. */
  settings?: { services: readonly string[] }
}

/** Which file a deploy uses (contracts/deploy.md). */
export type DeploySource =
  | { kind: "compose"; source: ComposeSource }
  | { kind: "settings"; source: ComposeSource }
  /** Both files in the folder and nothing says which: a question at a terminal, DP2 with none. */
  | { kind: "both"; folder: string }
