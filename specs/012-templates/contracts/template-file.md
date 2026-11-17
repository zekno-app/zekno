# Template File Contract: `apps/cli/src/templates/files/<name>.json` and the index

User Stories 1, 2 and 5 (FR-001 to FR-003d, FR-022, FR-023). The board `TemplateFile` is binding for
the format. The reader is `apps/cli/src/templates/` (`read.ts` reads and checks a file, `shape.ts`
holds the shape, `publishers.ts` the allowed sources, `file-words.ts` every sentence below); the
services part is checked by the settings reader of feature 010 (`settings/schema.ts`,
`checkSettingsValue`). Research R1 and R2 say why.

## Where a template comes from

- One file is one template: `apps/cli/src/templates/files/<name>.json`, in the public repository,
  added by a pull request a maintainer reviewed, shipped inside the CLI with a release, and named on
  one line of the index, `apps/cli/src/templates/files/index.ts` (below; decided on 2026-11-17).
- The CLI holds the texts of the files the index names, as they were when it was built (research
  R1). It never reads a
  template from the folder it runs in, the profile folder, a path given on the command line, or the
  network (FR-001). A file named `postgres.json` in the project folder or in `ZEKNO_HOME` changes
  nothing (a test puts one in each).
- Every file is read by the reader below each time the CLI first needs the catalogue, though it was
  checked when it was built: the reader is the same strict reader whatever the file's history.

## The format

```text
{
  "template": 1,                                  required; the version of the format
  "name": "<name>",                               required; the file's own name
  "title": "<title>",                             required
  "about": "<about>",                             required
  "software": "<version>",                        required; the version as people name it
  "author": "<author>",                           required
  "also": [ "<name>", ... ],                      optional; 0 to 8
  "services": { "<service>": <service>, ... },    required; 1 to 8, each a service of zekno.app.json
  "makes": { "<NAME>": { "kind": "password", "length": <24..64> }, ... },   required; 1 to 16
  "offers": { "<NAME>": "<text>", ... },          optional; 0 to 4
  "notes": [ "<sentence>", ... ],                 required; 1 to 8
  "asks": ...                                     reserved: refused by its presence (TF4)
}
```

The order of keys in a file does not matter. The files of the first set are written in the order
above, two spaces of indent.

| Field | What it is, and where it is shown | Rule |
|---|---|---|
| `template` | The version of the format. | The number `1` (TF1); an integer of 2 or more is a later version (TF2). |
| `name` | What a person types: `zekno add postgres`. In the list, the picker, the docs page. | `^[a-z][a-z0-9-]{0,31}$`, the file's name without `.json` (TF6, TF7), not another template's name or other name (TC1). |
| `title` | The software's name: `PostgreSQL`. | 1 to 40 characters of letters, digits, space, `.`, `+`, `-` (TF8). |
| `about` | What it is, one sentence: `A relational database.` The list and the picker show it without its full stop. | 1 to 80 printable ASCII characters, ending with `.` (TF9). |
| `software` | The software's version as people name it: `18.7`, `9.7`. Shown after the title. | `^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$` (TF10); the first service's image tag is it, or starts with it and a dot (`9.7` for `mysql:9.7.4`) (TF30). |
| `author` | Who wrote the file, credited in the list, `--show` and the docs page: `by zekno`. | `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`, the shape of a GitHub user name (TF11). |
| `also` | Names people may type instead, such as `mongo` for `mongodb`. Typing one is refused with a pointer to the right name (contracts/commands.md, AL3). | A list of 0 to 8 names, each held to the name rule, none twice, not the template's own name (TF12), and none another template's name or other name (TC2). |
| `services` | What goes into `zekno.app.json`: the same format, the same checks. Its volume `data` becomes `postgres-data` in the app, so no two services share one (board). Several are allowed. | 1 to 8 services (TF13), each passing every rule of feature 010's settings file (TS), and the rules TF21 to TF25 and TF32. |
| `makes` | Secrets made at random on the user's machine. | 1 to 16 names (TF14, TF15), each `{ "kind": "password", "length": <24 to 64> }` (TF16), each read by a service of the template (TF26). |
| `offers` | Connection secrets for the user's own services, built from the made secrets. | 0 to 4 names (TF17, TF18), each a text of at most 512 characters with placeholders (TF19, TF28, TF29), not a made name nor one the template's services read (TF27). |
| `notes` | Sentences shown before adding, each after `!` in the warning colour. | 1 to 8 sentences of at most 200 printable ASCII characters, each ending with `.` (TF20); `Zekno does not back up this data.` among them when a service keeps data in a volume (TF31). |
| `asks` | Questions to the user, such as a domain. Kept for the version that brings domains. | Refused by its presence, whatever its value (TF4). |

### A service

As a service of `zekno.app.json` (specs/010-app-settings/contracts/settings-file.md, "The
settings"): `source`, `deploy`, `networking`, `variables`, `volumes`, with every value and limit of
that contract, its later settings refused as there. On top of those, a template's service:

- names its image by version and digest, from an allowed source (TF21 to TF23);
- publishes no port (TF24); `networking.port` may be set, for the summary and `--show`;
- reads only secrets the template makes (TF25), and its plain values are fixed text;
- keeps its data in named volumes only, as every service of a settings file does; each volume is
  added to the app as `<service>-<volume>` (research R5), which must fit the volume name rule
  (TF32).

### Made secrets

`kind` is `password`, the only kind in this version: `length` letters and digits (`A-Z`, `a-z`,
`0-9`) from the system's random source, every character equally likely (research R6). Safe inside a
URL, a configuration line and a shell's double quotes. A later kind is a later version of the
format.

### Connection secrets (`offers`)

The text is built on the user's machine when the template is added, and stored as a secret:

- `{service}` is the name the template's first service gets in the app: the service's own name,
  or the one given with `--name`;
- `{NAME}` is the value of the made secret `NAME`;
- every other character stands for itself, and is a letter, a digit or one of `:/@?&=._%+~-`.

```text
offer       = 1*512( piece )
piece       = ALPHA / DIGIT / ":" / "/" / "@" / "?" / "&" / "=" / "." / "_" / "%" / "+" / "~" / "-"
            / "{service}" / "{" made-name "}"
made-name   = a name of `makes`
```

An offer uses at least one made secret (TF29). Shown before adding with `••••` in place of each made
value: `postgres://app:••••@postgres:5432/app`.

### Names

| Name | Rule |
|---|---|
| a template's `name`, an `also` | `^[a-z][a-z0-9-]{0,31}$` |
| a made or offered secret | `^[A-Z][A-Z0-9_]{0,127}$`, not reserved (`isReservedSecretName`) |
| a service, a volume, a plain variable | as in a settings file |

Made and offered names are capital letters so that `{service}` can never name one.

## The allowed sources (FR-002)

`apps/cli/src/templates/publishers.ts` lists the sources a template's image may come from, each with
how its images are written (FR-002: a Docker Official Image, from a list kept in the repository).
Changing the list is a change of code, reviewed as code, and is the maintainer's decision
(contracts/contributing.md, CG7). This version lists one:

| Source | How an image is written | Example |
|---|---|---|
| Docker Official Images (`docker.io/library`) | `<name>:<tag>@sha256:<64 hex>`, no registry and no `/` | `postgres:18.7@sha256:2ea8…61bbc` |

An image is pinned when it ends with `@sha256:` and 64 lowercase hex digits (TF21) and names a tag
(TF22); its source is allowed when it is written as one entry of the list writes its images
(TF23).

## The order of checks

The first fault stops the reader; tests name one sentence per file.

1. The file's name (TR1).
2. The bytes: at most 16,384 (TR2); strict UTF-8, a byte order mark at the very start dropped (TR3).
3. JSON, by `readJson` (TR4: its five faults, in the order of the text).
4. `template` (TF1, TF2).
5. Every key of the top, in the order of the text: one this zekno does not know (TF3), or `asks`
   (TF4), whichever comes first.
6. Each top-level field present and of its form, in the order of the text: `name`, `title`,
   `about`, `software`, `author`, `also`, `makes`, `offers`, `notes` (TF6 to TF20); a required field
   missing (TF5), in the order of the format.
7. `services` by the settings file's steps 3 to 6 (TS), then TF13's count.
8. The template's own rules, in this order: TF21, TF22, TF23 for each service's image in the order
   of the text; TF24; TF25; TF32; TF26; TF27; TF28; TF29; TF30; TF31.
9. Across the catalogue (the tests and the catalogue's first read): TC1, TC2.

## Sentences

Every fault is said as `<name> <place>: <rule>`, `<name>` being the file's name without `.json`
once it passed TR1 (the board: `acme-db services.db.source.image: pin the image by digest.`). A name
from the file is put in a place only after it passed its rule; a value from the file never is. The
tests put the marker `zk_SENTINEL_5d2a` in the wrong place of every faulty file and look for it in
the sentence, the error's message and stack.

### Reading

| Id | Place | Rule |
|----|-------|------|
| TR1 | (the file's own name, cleaned with `sanitize`, when it is not one) | `name a template file <name>.json, its name lowercase letters, digits and hyphens, starting with a letter, at most 32 characters.` |
| TR2 | `file` | `a template file is at most 16 KiB.` |
| TR3 | `file` | `a template file is UTF-8 text.` |
| TR4 | `line <n>` | the rule of SJ1 to SJ5 of feature 010 without its place: `this is not JSON.`, `the same name as line <m>.`, `nested deeper than templates go.`, `a text longer than 4096 characters.`, `a template is one JSON object.` |

### The fields

| Id | Place | Rule |
|----|-------|------|
| TF1 | `template` | `use 1, the version of templates this zekno reads.` |
| TF2 | | Two sentences, as SL0: `<name> is written for a later version of zekno.` and `Update zekno to use it.` |
| TF3 | `line <n>` | `a field this zekno does not know.` |
| TF4 | | Two sentences: `<name> asks a question when it is added.` and `Questions are not in this version of zekno yet. They come with domains.` |
| TF5 | `<field>` | `a template needs this field.` |
| TF6 | `name` | `use lowercase letters, digits and hyphens, starting with a letter, at most 32 characters.` |
| TF7 | `name` | `use the file's own name, <name of the file>.` |
| TF8 | `title` | `use 1 to 40 letters, digits, spaces, dots, plus signs and hyphens, such as "PostgreSQL".` |
| TF9 | `about` | `use one sentence of at most 80 characters that ends with a full stop, such as "A relational database."` |
| TF10 | `software` | `use the software's version as people name it, such as "18.7" or "9.7".` |
| TF11 | `author` | `use a name of letters, digits and inner hyphens, at most 39 characters, such as a GitHub user name.` |
| TF12 | `also` | `use a list of at most 8 other names people may type, each written as a template's name, none twice and not this one's, such as ["mongo"].` |
| TF13 | `services` | `name 1 to 8 services, such as { "postgres": { "source": { "image": "postgres:18.7@sha256:..." } } }.` |
| TF14 | `makes` | `name 1 to 16 secrets the template makes, such as { "POSTGRES_PASSWORD": { "kind": "password", "length": 32 } }.` |
| TF15 | `makes` | `a made secret's name uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself (line <n>).` |
| TF16 | `makes.<NAME>` | `use { "kind": "password", "length": <a number from 24 to 64> }.` |
| TF17 | `offers` | `name at most 4 connection secrets, such as { "DATABASE_URL": "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app" }.` |
| TF18 | `offers` | `a connection secret's name uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself (line <n>).` |
| TF19 | `offers.<NAME>` | `use at most 512 characters of letters, digits and :/@?&=._%+~- with {service} and the made secrets in braces.` |
| TF20 | `notes` | `use a list of 1 to 8 sentences, each at most 200 characters and ending with a full stop.` |

### The services, by the settings rules (TS)

A fault of feature 010's settings rules is said with its place as a path of the template file:
the settings place's `, ` becomes `.` and `services.` goes before it (`services` stays `services`);
its rule is the settings rule's own words. A later setting is said with its second sentence.

| Settings fault | Said by the template reader |
|---|---|
| SV8 `db, source.image: use an image reference, such as ghcr.io/acme/web:1.4.2.` | `acme-db services.db.source.image: use an image reference, such as ghcr.io/acme/web:1.4.2.` |
| SV6 `db, deploy: a setting this zekno does not know (line 14).` | `acme-db services.db.deploy: a setting this zekno does not know (line 14).` |
| SV2 `services: name at least one service, such as "web".` | `acme-db services: name at least one service, such as "web".` |
| SL5 for `db` | `acme-db services.db.networking.domains: Domains are not in this version of zekno yet.` |
| SV33, SV32 | `acme-db services: <the settings rule>` |

### The template's own rules

| Id | Place | Rule |
|----|-------|------|
| TF21 | `services.<svc>.source.image` | `pin the image by digest.` (board) |
| TF22 | `services.<svc>.source.image` | `name the image's version with a tag, such as postgres:18.7@sha256:<digest>.` |
| TF23 | `services.<svc>.source.image` | `use a Docker Official Image, or another source apps/cli/src/templates/publishers.ts lists.` |
| TF24 | `services.<svc>.networking.publish` | `a template publishes no port.` |
| TF25 | `services.<svc>.variables.secrets` | `<NAME> is not made by this template. A template's services read only the secrets it makes.` (`<NAME>` passed the secret-name rule already) |
| TF26 | `makes.<NAME>` | `no service of this template reads it.` |
| TF27 | `offers.<NAME>` | `it is the name of a made secret, or of one a service of this template reads.` |
| TF28 | `offers.<NAME>` | `each {...} names {service} or a secret this template makes.` |
| TF29 | `offers.<NAME>` | `build it from at least one secret this template makes.` |
| TF30 | `software` | `use the version the first service's image tag names, <tag>, or its start before a dot, such as 9.7 for 9.7.4.` |
| TF31 | `notes` | `say "Zekno does not back up this data." when a service keeps data in a volume.` |
| TF32 | `services.<svc>.volumes.<vol>` | `it is added as <svc>-<vol>, which must be a volume name of at most 63 characters.` |

### Across the catalogue

| Id | Place | Rule |
|----|-------|------|
| TC1 | `name` | `another template has this name, or names it in its also.` |
| TC2 | `also` | `<also> is another template's name, or in its also.` |

## What a file can never do

| Never | Because |
|---|---|
| Run code on the user's machine | It is JSON read by zekno's own reader; nothing in it is evaluated. Its only computations are a random password (`makes`) and placing values into a fixed text (`offers`). |
| Fetch anything | No field takes an address; the image is pulled by the server's Docker at the deploy, by the digest the file names. |
| Mount a folder of the server, or run privileged | Settings cannot say either: a volume is named and written as `type: "volume"`. |
| Publish a port | TF24, though settings can say `publish`. |
| Hold a secret's value | `secrets` lists names; made values exist only on the user's machine and in sealed records. |
| Read a secret the user must set | TF25: every secret its services read is made by it. |
| Be added twice to one app | Its made secret names are the app's (contracts/commands.md, AD5). |
| Use an image that can change | TF21: the digest fixes the bytes; a new image needs a new file in a new release. |

## The first set

Exactly these four files (research R4). Each `about` and `notes` is the board's or listed for the
maintainer in plan.md (D4 to D6).

`postgres.json`:

```json
{
  "template": 1,
  "name": "postgres",
  "title": "PostgreSQL",
  "about": "A relational database.",
  "software": "18.7",
  "author": "zekno",
  "also": [],
  "services": {
    "postgres": {
      "source": { "image": "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc" },
      "deploy": { "restart": "always" },
      "networking": { "port": 5432 },
      "variables": {
        "secrets": ["POSTGRES_PASSWORD"],
        "plain": { "POSTGRES_USER": "app", "POSTGRES_DB": "app" }
      },
      "volumes": { "data": "/var/lib/postgresql" }
    }
  },
  "makes": {
    "POSTGRES_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "DATABASE_URL": "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app"
  },
  "notes": ["Zekno does not back up this data."]
}
```

`mysql.json`:

```json
{
  "template": 1,
  "name": "mysql",
  "title": "MySQL",
  "about": "A relational database.",
  "software": "9.7",
  "author": "zekno",
  "also": [],
  "services": {
    "mysql": {
      "source": { "image": "mysql:9.7.4@sha256:df90258da46f6e7ff8574ff84f17618aba0765cac749928299c69fd4e7cb8ad8" },
      "deploy": { "restart": "always" },
      "networking": { "port": 3306 },
      "variables": {
        "secrets": ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD"],
        "plain": { "MYSQL_USER": "app", "MYSQL_DATABASE": "app" }
      },
      "volumes": { "data": "/var/lib/mysql" }
    }
  },
  "makes": {
    "MYSQL_ROOT_PASSWORD": { "kind": "password", "length": 32 },
    "MYSQL_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "DATABASE_URL": "mysql://app:{MYSQL_PASSWORD}@{service}:3306/app"
  },
  "notes": ["Zekno does not back up this data."]
}
```

`mongodb.json`:

```json
{
  "template": 1,
  "name": "mongodb",
  "title": "MongoDB",
  "about": "A document database.",
  "software": "9.0",
  "author": "zekno",
  "also": ["mongo"],
  "services": {
    "mongodb": {
      "source": { "image": "mongo:9.0.8@sha256:b0c835c26e5997413e985000f1013c275377cd9607761c1784d486f6dd620b7f" },
      "deploy": { "restart": "always" },
      "networking": { "port": 27017 },
      "variables": {
        "secrets": ["MONGO_INITDB_ROOT_PASSWORD"],
        "plain": { "MONGO_INITDB_ROOT_USERNAME": "app" }
      },
      "volumes": { "data": "/data/db" }
    }
  },
  "makes": {
    "MONGO_INITDB_ROOT_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "MONGODB_URI": "mongodb://app:{MONGO_INITDB_ROOT_PASSWORD}@{service}:27017/app?authSource=admin"
  },
  "notes": [
    "Zekno does not back up this data.",
    "Your app connects as the database's administrator."
  ]
}
```

`redis.json`:

```json
{
  "template": 1,
  "name": "redis",
  "title": "Redis",
  "about": "A cache and key-value store.",
  "software": "8.10",
  "author": "zekno",
  "also": [],
  "services": {
    "redis": {
      "source": { "image": "redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53" },
      "deploy": {
        "start": "sh -c 'umask 077 && printf \"requirepass %s\\n\" \"$REDIS_PASSWORD\" > /tmp/auth.conf && chown redis /tmp/auth.conf && exec docker-entrypoint.sh redis-server /tmp/auth.conf'",
        "restart": "always"
      },
      "networking": { "port": 6379 },
      "variables": { "secrets": ["REDIS_PASSWORD"] },
      "volumes": { "data": "/data" }
    }
  },
  "makes": {
    "REDIS_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "REDIS_URL": "redis://default:{REDIS_PASSWORD}@{service}:6379"
  },
  "notes": ["Zekno does not back up this data."]
}
```

The order of the list and the picker: the four of the first set in the boards' order (postgres,
mysql, mongodb, redis), then every other template by name (plan.md, D8, approved).

## The index

`apps/cli/src/templates/files/index.ts` names every template file, one line each, in the order of
their names, and nothing else (research R1). For the first set, exactly:

```ts
/**
 * The template files this zekno carries: one line for each file of this
 * folder, in the order of their names (specs/012-templates,
 * contracts/template-file.md, "The index"). Each file is taken as its text,
 * for the strict reader. A test fails when a file and its line do not match.
 */
export const TEMPLATE_FILES = [
  ["mongodb", await import("./mongodb.json", { with: { type: "text" } })],
  ["mysql", await import("./mysql.json", { with: { type: "text" } })],
  ["postgres", await import("./postgres.json", { with: { type: "text" } })],
  ["redis", await import("./redis.json", { with: { type: "text" } })],
] as const
```

A new template's line is `  ["<name>", await import("./<name>.json", { with: { type: "text" } })],`,
in its place by name. The path is written out, so the compiled CLI holds the file and the layering
test can follow it. `templates/catalogue.ts` makes `TEMPLATE_TEXTS` of it, `<name>.json` and the
file's text, and checks each line gave text.

`test/templates/index.test.ts` reads the folder from the disk and the index as a module and as text,
and fails with one of these, the first that applies, naming the file:

| Id | Sentence |
|----|----------|
| TI1 | `<name>.json is not in the index. Add this line to apps/cli/src/templates/files/index.ts, in its place by name:` then the line |
| TI2 | `The index names <name>.json, which is not in apps/cli/src/templates/files. Remove its line, or add the file.` |
| TI3 | `The index's line for <name> takes another file. Write ./<name>.json in it.` |
| TI4 | `The index lists its lines in the order of the names: <name> goes before <other>.` |
| TI5 | `apps/cli/src/templates/files holds <file>, which is not a template file. A template file is named <name>.json.` (anything but `index.ts` and template files) |

## Tests

- `test/templates/read.test.ts`: every good fixture of `test/support/template-files.ts` reads to
  its `Template`; one faulty fixture per sentence above, each built so that its sentence and no
  earlier one applies; the sentinel nowhere; the board's broken `acme-db` file
  (`"image": "acme/db:1.0"` with no digest) gives exactly
  `acme-db services.db.source.image: pin the image by digest.`
- `test/templates/files.test.ts`: for each file of `templates/files/`, the three tests of the board
  (contracts/contributing.md, "The template tests"); the four of the first set equal the texts
  above, byte for byte.
- `test/templates/index.test.ts`: TI1 to TI5, each with a folder or an index text built to break
  it, and the real folder and index passing.
- `test/templates/catalogue.test.ts`: the catalogue is the files the index names and nothing else (a
  `postgres.json` in the folder the command runs in and in `ZEKNO_HOME` changes nothing); TC1, TC2;
  the order.
