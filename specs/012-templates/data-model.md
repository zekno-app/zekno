# Data Model: Templates

Four new data files inside the CLI, one per template, and an index that names each on one line
(`templates/files/index.ts`). Nothing new is stored in the project folder
but the services a template adds to `zekno.app.json` (feature 010's format, unchanged), and nothing
new in the profile folder but the sealed secret records `zekno secret set` already writes (same
format). No message, signed text or file format of `packages/core`, the runner or the profile
changes. Names in `code` are the planned TypeScript names; the types live in
`apps/cli/src/templates/types.ts` unless said otherwise.

## The template file

`apps/cli/src/templates/files/<name>.json`. Its grammar, limits, order of checks and every sentence
are [contracts/template-file.md](./contracts/template-file.md); the four files of the first set are
written out there.

| Field | Type | Rule (short) | Left out |
|---|---|---|---|
| `template` | number | `1`; 2 or more is a later version | refused (TF5) |
| `name` | string | `^[a-z][a-z0-9-]{0,31}$`, the file's own name | refused |
| `title` | string | 1 to 40 of letters, digits, space, `.+-` | refused |
| `about` | string | 1 to 80 printable ASCII, ends with `.` | refused |
| `software` | string | the version as people name it; the first service's image tag is it or starts with it and a dot | refused |
| `author` | string | a GitHub user name's shape, at most 39 | refused |
| `also` | string[] | 0 to 8 names, none twice, not its own | none |
| `services` | object | 1 to 8 services of `zekno.app.json`, plus TF21 to TF25, TF32 | refused |
| `makes` | object | 1 to 16 `NAME: { kind: "password", length: 24..64 }`, each read by a service | refused |
| `offers` | object | 0 to 4 `NAME: text` with `{service}` and `{MADE}` | none |
| `notes` | string[] | 1 to 8 sentences, the backup note when a volume is kept | refused |
| `asks` | any | refused by its presence (TF4) | (the only accepted state) |

The whole file: at most 16 KiB, strict UTF-8, JSON as `zekno.app.json` is read (no duplicate key,
depth at most 6, strings at most 4,096 characters).

## A template as read

```ts
/** A secret a template makes at random on the user's machine. */
type MadeSecret = {
  name: string
  /** The only kind in this version: letters and digits. */
  kind: "password"
  /** 24 to 64. */
  length: number
}

/** A connection secret a template offers to the app's own services. */
type Offer = {
  name: string
  /** As the file writes it: `{service}` and `{MADE}` placeholders, the rest fixed text. */
  text: string
}

/** One template file, read and checked whole. Lists keep the file's order. */
type Template = {
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
type TemplateFault =
  /** `<name> <place>: <rule>` (TR, TF, TS, TC). */
  | { kind: "form"; place: string; rule: string; line?: number }
  /** Two sentences: a later version (TF2) or a question (TF4). */
  | { kind: "later"; first: string; second: string }
```

`readTemplate(file: string, text: string): Template | TemplateFault` (`templates/read.ts`) never
throws, and builds every place from names that passed their rule and every rule from fixed words.

## The catalogue

```ts
/** The templates this zekno carries, in their order (contracts/template-file.md, "The first set"). */
type Catalogue = readonly Template[]
```

`catalogue()` (`templates/catalogue.ts`) reads `TEMPLATE_TEXTS`, the `[file name, text]` pairs it
makes of the index, `TEMPLATE_FILES` (contracts/template-file.md, "The index"; research R1), once per
run, with `readTemplate`, checks TC1 and TC2, and orders
them. A fault is AD27 (a released zekno never has one). `findTemplate(name)` gives the template, or
`{ also: string }` when `name` is in a template's `also`, or `undefined`.

## A made value

Not a type that leaves its function. Made in `ops/add-commit.ts` (research R6) as a `Map<string,
string>` from each made name to its value, and each connection secret's value built from it, in
the local scope of the one function that seals them. Never in a plan, an error, an event, a line,
a log or a returned value.

```ts
/** Letters and digits from the system's random source, every character equally likely. */
function makePassword(length: number, random?: (bytes: Uint8Array) => void): string
/** An offer's text with `{service}` and each `{MADE}` filled in. */
function fillOffer(offer: Offer, service: string, made: ReadonlyMap<string, string>): string
/** The same text for a person: `••••` in place of each made value. */
function shownOffer(offer: Offer, service: string): { text: string; hidden: boolean }[]
```

`random` is `crypto.getRandomValues` but in tests, which give a stand-in that yields a sentinel
(contracts/commands.md, "Tests").

## An addition

What one run of `zekno add` would do, before anything is written (`templates/addition.ts`, pure: no
file, no team, no clock).

```ts
type Addition = {
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
type AdditionRefused = { id: "AD6" | "AD7" | "AD9" | "AD14" | "AD15" | "AU9"; sentence: string; status: 2 }

function planAddition(input: {
  template: Template
  settings: Settings
  file: string
  name?: string
  /** Undefined: decide from the file (one other service), or say which offers need a question. */
  readers?: readonly string[]
}): Addition | AdditionRefused | { ask: readonly { offer: string; services: readonly string[] }[] }
```

The added settings are checked as `checkSettings(settingsText(settings), file)` reads them, so the
file zekno writes is one its reader reads (AD15 otherwise), as feature 010's `applyChange` checks a
change.

## What `zekno add` prepares, and commits

In `apps/cli/src/ops/add.ts`:

```ts
/** Where the template goes: the settings file a deploy here would sign, or a hand-written Compose file. */
type AddTarget =
  | { kind: "settings"; read: SettingsRead; named: string; both: boolean }
  | { kind: "hand"; file: string }

/** Everything read and checked up to the question. Holds no secret value. */
type AddPlan = {
  target: AddTarget
  template: Template
  addition: Addition
  team: Team
  server: Server
  app: string
  /** The app's secret store as read, compared again before it is written (research R7). */
  store: SecretStore
  /** The version each secret will get: the highest this machine has seen for its name, plus one. */
  versions: ReadonlyMap<string, number>
}

type AddDone = {
  service: string
  /** Set when a settings file was written. */
  file?: string
  stored: readonly { name: string; version: number }[]
  server: string
}
```

`SettingsRead` (feature 010, `settings/types.ts`) gains `bytes: Uint8Array`, the bytes read, so
step f of research R7 can put them back exactly. Nothing else of feature 010's types changes.

`commitAdd(plan, options?)` (`ops/add-commit.ts`) runs steps a to f of contracts/commands.md,
"Whole or not at all", and gives an `AddDone` or throws the step's sentence. `options` lets a test
replace the random source and make a step fail.

## What is shown

In `apps/cli/src/templates/types.ts`, for `ui/types.ts` (types only):

```ts
/** One row of `zekno add --list` and of the picker. */
type TemplateRow = { name: string; title: string; software: string; about: string; author: string }

/** The summary before the question (board `AddTemplate`). Every value is a name that passed its rule or fixed words. */
type AdditionReport = {
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
    readBy: readonly string[]
  }[]
  notes: readonly string[]
}

/** `zekno add <template> --show` (board `AddLook`). */
type TemplateView = {
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
type HandLines = {
  file: string
  service: readonly string[]
  volumes: readonly string[]
  offers: readonly string[]
}

/** What was done, for the result lines and the plain lines. */
type AddedShown = AddDone
```

`ListRow` (`ui/types.ts`) gains `column?: string`, a middle column drawn in the text colour (the
picker). A new question type:

```ts
/** A list to pick several rows from: rows, the first picked when it opens, `collapsed` for the line left behind. */
type SeveralQuestion<T> = { question: string; rows: readonly ListRow<T>[]; collapsed: string; atLeastOne: string; missing: Error }
```

## The order a run goes through

```text
words and options ─▶ (--list │ --show: shown, end)
        │
        ▼
the template given, --name ─▶ AD1 (a profile with a server) ─▶ the picker, when none was given
        │
        ▼
which file ─▶ settings file: read whole ─────────────┐
        │  └▶ Compose file: the hand-written path ─────┤
        │  └▶ none: AD13                               │
        ▼                                              ▼
app and server (flags, link, questions) ─▶ the store: AD5, AD24, AD25
        │
        ▼
service and volume names (AD6, AD9) ─▶ readers (--for, one, the question, AD12) ─▶ AD7 ─▶ AD15
        │
        ▼
the summary ─▶ the question / --yes / AD4 ─▶ no: AD22
        │ yes
        ▼
a: file unchanged ─▶ b: store unchanged ─▶ c: made and sealed ─▶ d: file written ─▶ e: store written ─▶ added
                                                                        │ e failed
                                                                        ▼
                                                              f: file put back ─▶ AD20 │ AD19
```

Nothing is written before d. After a failure at a, b, c or d nothing was written; at e, f undoes d.

## Validation summary

- A template file is read only by `readTemplate`, from the texts of the files the index names, as
  the CLI was built with them; its
  services only by feature 010's rules.
- An addition is checked whole by the settings reader before it is shown.
- A made value exists only between step c and the end of step e, in one function, and reaches only
  `createSecret`.
- The settings file is written only by feature 010's `writeSettings` and put back only by
  `restoreSettings`, each comparing by SHA-256 first.
- The secret store is written once per run, after it was compared with the store read before the
  question.
