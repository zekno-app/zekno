/**
 * The types of an app's settings file, `zekno.app.json`
 * (specs/010-app-settings, data-model.md): the settings as read, a fault in
 * the file, a change of one setting, what is shown, and which file a deploy
 * uses. Types only: the reader, the writer and the Compose text are the other
 * files of this folder.
 */
import type { Health as SignedHealth, Route } from "@workspace/core"

import type { ComposeSource, ComposeText } from "../project/compose-read"
import type { LineOf } from "../shared/build-lines"
import type { BuildFault, BuildSettingName } from "./build-faults"

/**
 * A service's Build section (specs/016-build-from-source, data-model.md,
 * "The settings' Build section"; CL1). Absent: not set, so the default.
 */
export type BuildSettings = {
  /** `dockerfile` in step 1; a file naming `railpack` is F5 (FR-008). */
  builder: "dockerfile"
  /** Relative to the folder sent; `Dockerfile` when left out. */
  dockerfile?: string
  /** The stage built; the last one when left out. */
  stage?: string
  /** In seconds, 1 to 7,200; 1,800 when left out (FR-010). */
  timeout?: number
  /** `internet` when left out. */
  network?: "internet" | "none"
}

/**
 * One service's settings, as the file holds them. Absent: not set. A service
 * has an image or a build, never both and never neither (FR-006); `root`
 * and `include` only with a build (specs/016-build-from-source, CL1).
 */
export type ServiceSettings = {
  image?: string
  /** The folder sent, from the settings file's folder, `/` between its parts; `.` when left out. */
  root?: string
  /** Secret-looking files to send all the same, relative to the root, in the file's order; never empty (FR-015). */
  include?: readonly string[]
  build?: BuildSettings
  start?: string
  restart?: "no" | "on-failure" | "always"
  memory?: string
  /** As written in the file, held to research R1's form: "1", "0.5". */
  cpus?: string
  /**
   * The health check (specs/015-domains-https, contracts/cli.md, CL1): the
   * path asked on the service's port, and the limit in seconds as the file
   * writes it, 60 when left out. Neither: the service stays up, within 60s.
   */
  health?: Health
  port?: number
  publish?: number
  /** The domains that reach this service on its port (CL1), lowercase, in the file's order; never empty. */
  domains?: readonly string[]
  secrets?: readonly string[]
  plain?: readonly (readonly [name: string, value: string])[]
  volumes?: readonly (readonly [name: string, path: string])[]
}

/** A service's health check, as the file holds it (CL1). */
export type Health = { path?: string; timeout?: number }

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
  /** The bytes read, so a run that wrote the file can put it back exactly (specs/012-templates, research R7) */
  bytes: Uint8Array
  /** The file's identity and mode, from the descriptor it was read from. */
  dev: number
  ino: number
  mode: number
  settings: Settings
}

/**
 * A setting a later version of zekno brings: refused by its presence (SL0 to
 * SL4). `version` is the file's own `zekno`. Domains and the health check
 * were later settings until feature 015 (specs/015-domains-https, CL1), a
 * build until feature 016 (specs/016-build-from-source, CL1): no reader
 * gives `build` any more; it stays while fault-words.ts keeps its words.
 */
export type LaterSetting = "version" | "build" | "predeploy" | "replicas"

/** Why the file could not be used, as the sentences say it. Never a piece of the file's content. */
export type SettingsFault =
  /** The bytes could not be read (SR1 to SR9). */
  | { kind: "read"; sentence: string }
  /** Not settings this zekno reads (SJ1 to SJ5, SV1 to SV33): where, and the rule. An empty place: the rule is said alone. */
  | { kind: "form"; place: string; rule: string; line?: number }
  /** A setting a later version brings (SL0 to SL5): what it sets, for which service. */
  | { kind: "later"; setting: LaterSetting; service?: string }
  /** A fault of a service's build settings, said by its line's id (specs/016-build-from-source, CL1; build-faults.ts). */
  | { kind: "build"; fault: BuildFault }

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
        // specs/015-domains-https, CL1: the whole list; the health check, a path or `up`; its limit in seconds.
        | "domains"
        | "health"
        | "health-timeout"
    }
  /** specs/016-build-from-source, CL1: the Build section and the fields of Source a build adds. */
  | { service: string; key: BuildSettingName }
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
  /**
   * An image replaced by a build, or a build by an image, in one change
   * (specs/016-build-from-source, FR-011): the line said for it, G12 or G13.
   * Until the words tasks the label is the line's id (FR-092).
   */
  line?: LineOf<"G12" | "G13">
}

/**
 * A Build row's value as G10 reads it (specs/016-build-from-source): the
 * builder, or a time limit in whole minutes, else in seconds.
 */
export type BuildRowValue =
  | { builder: BuildSettings["builder"] }
  | { minutes: number }
  | { seconds: number }

/** One row of a service's settings, for `zekno settings` and the screen. */
export type SettingRow = {
  /** `Build` between Source and Deploy (specs/016-build-from-source, G9, J16). */
  section:
    "Source" | "Build" | "Deploy" | "Networking" | "Variables" | "Volumes"
  /** The row's label: "image", "memory", "published", "plain", a volume's name. Empty on a second plain row. */
  label: string
  /** The setting the row changes; a `none` row of plain or volumes adds one. */
  path: SettingPath | { service: string; key: "plain" | "volume"; adding: true }
  /** What a person reads, cleaned; `set` false when it is the words of a setting left out. */
  shown: string
  set: boolean
  /**
   * A Build row's value as G10 reads it, for the words tasks to draw
   * (specs/016-build-from-source, CL1, "Rows"; FR-092): `shown` is then G10's
   * id until those words are written.
   */
  value?: BuildRowValue
  /** Changed since this machine's last deploy, with the old value when there was one, and as G10 reads it for a Build row. */
  changed?: { was?: string; wasValue?: BuildRowValue }
  /**
   * A plain variable or a volume the last deploy had and the file no longer
   * has, with what it was (security review S3): the next deploy drops it. Its
   * row reads as a setting left out, and adds one, as a `none` row does.
   */
  removed?: { was: string }
}

/** What `zekno settings` shows. */
export type SettingsReport = {
  /** The app, when this folder's zekno.json names it and is in use here. */
  app?: string
  file: string
  services: readonly { name: string; rows: readonly SettingRow[] }[]
  /**
   * The services the last deploy had and the file no longer has, each with
   * the image it ran (security review S3): the next deploy stops them.
   */
  removed?: readonly { name: string; was: string }[]
  /** IN6, when compose.yaml is beside the settings file and nothing decides which a deploy uses. */
  note?: string
  /**
   * What plain output prints, one line per setting that is set: the service,
   * the setting's place in the file and its value as the file holds it
   * (settings/piped.ts). Left out, plain output prints no setting.
   */
  piped?: readonly (readonly [service: string, place: string, value: string])[]
}

/**
 * What a deploy reads, whichever kind of file it came from. A Compose file
 * written by hand has no routes and no health check (specs/015-domains-https,
 * contracts/cli.md, CL3).
 */
export type DeployText = ComposeText & {
  /**
   * Set for a settings file: its services, for the summary's `from` line, the
   * SHA-256 of the bytes read, and the routes and the health check the deploy
   * signs (domains/routes.ts): no route is `[]`, no health check `null`.
   */
  settings?: {
    services: readonly string[]
    sha256: string
    routes: readonly Route[]
    health: SignedHealth | null
  }
}

/** Which file a deploy uses (contracts/deploy.md). */
export type DeploySource =
  | { kind: "compose"; source: ComposeSource }
  | { kind: "settings"; source: ComposeSource }
  /** Both files in the folder and nothing says which: a question at a terminal, DP2 with none. */
  | { kind: "both"; folder: string }
