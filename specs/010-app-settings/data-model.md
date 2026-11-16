# Data Model: App settings

One new file in a project folder, `zekno.app.json`, written by the person or by zekno. Nothing new
is stored in the profile folder, nothing new is signed, and no message changes. What else is new
is held in memory for one run of a command, or while the app shows the settings screen. Names in
`code` are the planned TypeScript names; the types live in `apps/cli/src/settings/types.ts`
unless said otherwise.

## The settings file

`zekno.app.json`, in the project folder, beside the code. Content of the project, like a Compose
file: not signed where it lies, never holding a secret's value. Its grammar and every fault are
[contracts/settings-file.md](./contracts/settings-file.md).

| Field | Type | Rule | Left out | Now or later |
|---|---|---|---|---|
| `zekno` | number | `1`; an integer of 2 or more is a later version (SL0) | refused (SV1) | now |
| `services` | object | 1 to 32 services, in the file's order | refused (SV2) | now |
| `services.<name>` | object | name `^[a-z][a-z0-9-]{0,62}$` | | now |
| `source.image` | string | an image reference, at most 255 characters | refused (SV7) | now |
| `source.build` | any | refused with SL1 | | later (design.md's C1) |
| `deploy.start` | string | the start-command grammar, 1 to 4,096 characters, 1 to 256 words | the image's own command | now |
| `deploy.restart` | string | `no`, `on-failure`, `always` | Compose's default, `no` | now |
| `deploy.memory` | string | `^[1-9][0-9]{0,4}[mg]$`, at least `6m` | no limit | now |
| `deploy.cpus` | number | `0.01` to `1024`, at most two decimals | no limit | now |
| `deploy.predeploy` | any | refused with SL2 | | later |
| `deploy.healthcheck` | any | refused with SL3 | | later (design.md's C3) |
| `deploy.replicas` | any | refused with SL4 | | later |
| `networking.port` | number | integer 1 to 65535 | none | now |
| `networking.publish` | number | integer 1 to 65535; needs `port`; unique across services | not published | now |
| `networking.domains` | any | refused with SL5 | | later (design.md's C3) |
| `variables.secrets` | string[] | secret names: `SECRET_NAME`, at most 128 characters, not reserved, not twice; at most 256 | none | now |
| `variables.plain` | object | name to value; names as secret names; values one line, no control character, at most 4,096 characters; not also a secret of the service; at most 128 | none | now |
| `volumes` | object | volume name `^[a-z][a-z0-9_-]{0,62}$` to an absolute mount path in the container; at most 16; no two at one path | none | now |

Limits of the whole file: at most 65,536 bytes; strict UTF-8 (a byte order mark at the very start
is dropped); objects nested at most 6 deep; any key or string at most 4,096 characters; at most
256 different secret names across the services; the Compose text it turns into at most 256 KiB.

Every string a setting holds is well formed and has no `Cc` character, no U+2028, U+2029,
U+FEFF, U+FFFE or U+FFFF (research R1).

A "later" setting is refused by its presence, whatever its value, so a file that uses one is
never half read. A file valid now stays valid when they arrive (FR-007): no setting of today
changes meaning, and the later ones go only in the places reserved above.

## The settings as read

```ts
/** One service's settings, as the file holds them. Absent: not set. */
type ServiceSettings = {
  image: string
  start?: string
  restart?: "no" | "on-failure" | "always"
  memory?: string
  /** As written in the file, held to R1's form: "1", "0.5". */
  cpus?: string
  port?: number
  publish?: number
  secrets?: readonly string[]
  plain?: readonly (readonly [name: string, value: string])[]
  volumes?: readonly (readonly [name: string, path: string])[]
}

/** The whole file, read and checked. Services, plain variables and volumes in the file's order. */
type Settings = {
  version: 1
  services: readonly (readonly [name: string, service: ServiceSettings])[]
}

/** A file as it was read from the disk: what a later write compares against. */
type SettingsRead = {
  /** The file's path, as the reader opened it (a real path for one inside a folder). */
  path: string
  /** As a sentence names it: relative to the folder the command runs in when inside it. */
  shown: string
  /** The SHA-256 of the bytes read, and the file's identity and mode. */
  sha256: string
  dev: number
  ino: number
  mode: number
  settings: Settings
}
```

Lists and ordered pairs, never plain objects, so the order of the file is kept whatever a name
looks like.

### A fault

```ts
/** Why the file could not be used, as the sentences say it. Never a piece of the file's content. */
type SettingsFault =
  /** The bytes could not be read (SR1 to SR9). */
  | { kind: "read"; sentence: string }
  /** Not settings this zekno reads (SJ1 to SJ5, SV1 to SV33): where, and the rule. */
  | { kind: "form"; place: string; rule: string; line?: number }
  /** A setting a later version brings (SL0 to SL5): what it sets, for which service. */
  | { kind: "later"; setting: LaterSetting; service?: string }
```

`place` is built from names that passed their rule only (a service, a secret, a variable, a
volume); a name that did not pass is named by its line. `rule` is a fixed sentence. Both are
cleaned with `sanitize` before they are shown, though nothing in them can need it.

## A change

```ts
/** One setting of one service, as `zekno settings set` and the screen name it. */
type SettingPath =
  | { service: string; key: "image" | "start" | "restart" | "memory" | "cpus" | "port" | "publish" | "secrets" }
  | { service: string; key: "plain"; name: string }
  | { service: string; key: "volume"; name: string }

/** What `set` or `unset` asks for, before anything is written. `value` undefined: unset. */
type Change = {
  path: SettingPath
  /** The setting's words for a person: "memory limit", "start command", "volume uploads". */
  label: string
  /** As a person reads them: "512m", "no limit", "on failure". */
  now: string
  next: string
  value?: string | number | readonly string[]
  /** The settings with the change made, read back as a check (R5). */
  settings: Settings
}
```

`parseSettingPath(text)` reads `web.memory` and `web.deploy.memory`, `web.plain.NAME` and
`web.variables.plain.NAME`, `web.volumes.name`; a later setting (`web.domains`) is its own fault.
`applyChange(settings, path, value)` returns the new settings or the fault of the setting
(CS7, CS15, CS17). Applying the same value is no change (CS8).

## The Compose text

A string: the bytes `composeText(settings)` writes ([contracts/compose-text.md](./contracts/compose-text.md)).
It is what a deploy reads in place of a Compose file (`ComposeText` in `project/compose-read.ts`,
`{ text, path }`, with `path` the settings file's), what is checked, signed, sent and recorded,
and what `zekno settings compose` prints. It never holds a secret's value. The same settings
give the same bytes on every machine.

```ts
/** What a deploy reads, whichever kind of file it came from. */
type DeployText = ComposeText & {
  /** Set for a settings file: its services, for the summary's `from` line. */
  settings?: { services: readonly string[] }
}
```

`deployedSettings(text)` reads a Compose text back into `Settings`, or gives `undefined` when
`composeText` of what it read is not those very bytes (research R4).

## Which file a deploy uses

```ts
type DeploySource =
  | { kind: "compose"; source: ComposeSource }
  | { kind: "settings"; source: ComposeSource }
  /** Both files in the folder and nothing says which: a question at a terminal, DP2 with none. */
  | { kind: "both"; folder: string }
```

`ComposeSource` is the existing type (`project`, `default`, `given`); for the settings kind it
names a `zekno.app.json`. `chooseSource(cwd, input)` applies the rule of
[contracts/deploy.md](./contracts/deploy.md); `readSource(source)` reads the one file once and
returns a `DeployText`.

## What is shown

```ts
/** One row of a service's settings, for `zekno settings` and the screen. */
type SettingRow = {
  section: "Source" | "Deploy" | "Networking" | "Variables" | "Volumes"
  /** The row's label: "image", "memory", "published", "plain", a volume's name. */
  label: string
  path: SettingPath | { service: string; key: "plain" | "volume"; adding: true }
  /** What a person reads; `set` false when it is the dim words of a setting left out. */
  shown: string
  set: boolean
  /** Changed since this machine's last deploy, with the old value when there was one. */
  changed?: { was?: string }
}

type SettingsReport = {
  /** The app, when this folder's zekno.json names it and is in use here. */
  app?: string
  file: string
  services: readonly { name: string; rows: readonly SettingRow[] }[]
  /** SH3, when this folder's zekno.json names a Compose file instead. */
  note?: string
}
```

`zekno settings` prints only the rows that are set; the screen shows every row a setting of
today has (contracts/app-screen.md), the left-out ones dim.

## The settings screen's state

In `apps/cli/src/app/state/types.ts`:

```ts
| {
    name: "settings"
    server: string
    app: string
    /** The service shown, by its place in the file. */
    service: number
    /** The selected row of that service. */
    row: number
    /** The pane shows the settings, or the Compose text they turn into (`c`). */
    showing: "settings" | "compose"
    /** Lines of the Compose text scrolled past. */
    scroll: number
    change?: ScreenChange
  }

type ScreenChange = {
  path: SettingPath
  stage: "typing" | "picking" | "asking"
  /** What is typed so far (typing), or the row of the list (picking). */
  typed: string
  pick: number
  /** Why the typed value was refused, drawn under it. */
  reason?: string
  /** Once checked: the value and how it reads. */
  next?: { value: string | number | readonly string[] | undefined; shown: string }
  now: string
}
```

and in `State`:

```ts
/** What the settings screen shows, once read for that app (effects/settings.ts). */
settingsView?: {
  server: string
  app: string
  outcome:
    | { kind: "read"; report: SettingsReport; settings: Settings; sha256: string; compose: string }
    | { kind: "sentence"; sentence: string }
    | { kind: "fault"; first: string; rest: string }
}
```

Only names, values that are not secret and the SHA-256 of the file are kept: a secret's value
never reaches the state, as it never reaches the file.

Effects (`app/state/events.ts`): `{ kind: "read-settings"; server; app; deployed: boolean }`
(`deployed`: read this machine's last deploy again too), `{ kind: "write-setting"; server; app;
path; value; sha256 }`. Events: `settings-read` (the view), `setting-written`,
`setting-refused` (a notice).

## Validation summary

- The reader is the only code that sees the file's text; every fault it gives is built from a
  line number, the names that passed their rule, and fixed words (SC-005).
- A value is checked by the same function wherever it comes from: the file, `zekno settings set`,
  the screen (`settings/values.ts`).
- A written file is always read back by the reader before it replaces the old one.
- The Compose text is only ever made by `composeText`, from settings that passed the reader.
