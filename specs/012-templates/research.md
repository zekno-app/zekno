# Research: Templates

Checked on 2026-11-17 on macOS (Apple silicon) with Bun 1.4.4, Docker Engine 29.6.1 and Docker
Compose 5.3.0, and the repository at `d19b25f` on `012-templates`. What the maintainer decided
(spec.md, Clarifications of 2026-11-17, and the four approved boards in [design/](./design/)) is
binding and is marked **(maintainer)**. The rest follows from it, from the code, or from the probes
below. Nothing was run on a server of the maintainer's, no `ssh` was used, and no file of the
repository but these documents was written.

The probes ran in the session's scratchpad (`probe012/`), never in the repository:

- `macro/` and `index/`: two ways to put the template files into the CLI, a Bun macro and an index
  of text imports (three forms), each run with `bun run`, `bun test` and `bun build --compile`,
  read by `Bun.Transpiler.scanImports` and `transformSync`, checked by `tsc` with the CLI's compiler
  options, and the index formatted by Prettier at 80 columns (R1).
- `run.sh`: each proposed template's service written as `zekno.app.json` beside a client service,
  turned into Compose text by the real `zekno settings compose` of this branch (with `ZEKNO_HOME`
  pointed at an empty scratch folder), started with real Docker as project `zekno-probe-<name>-<mode>`,
  checked, and removed with `docker compose down -v` (R3, R4). No port was published. Every password
  was made in the probe's shell, passed to Docker Compose through its environment only, compared and
  never printed.
- `entrypoints/`: the entrypoint script of each pinned image, copied out with
  `docker run --rm --network none --entrypoint cat` and read (R3).
- A hand-written Compose file read by `docker compose config`, which reads a file and starts
  nothing (R10).

At the end no container, network or volume of a `zekno-probe-` project was left
(`docker ps -a`, `docker network ls`, and `docker volume ls` by the Compose project label). The four
pinned images stay in the local image store, for the builder's real Docker task.

## R1. Where templates live, and how they reach the CLI **(maintainer: inside the CLI, one data file per template, nothing downloaded; an index file, decided 2026-11-17 after the plan)**

- **Decision.** The template files are `apps/cli/src/templates/files/<name>.json`, one per
  template, read by the strict reader of R2. Beside them, `apps/cli/src/templates/files/index.ts`
  names each file on one line:

  ```ts
  export const TEMPLATE_FILES = [
    ["mongodb", await import("./mongodb.json", { with: { type: "text" } })],
    ["mysql", await import("./mysql.json", { with: { type: "text" } })],
    ["postgres", await import("./postgres.json", { with: { type: "text" } })],
    ["redis", await import("./redis.json", { with: { type: "text" } })],
  ] as const
  ```

  `templates/catalogue.ts` turns it into `TEMPLATE_TEXTS`, `[file name, text]` pairs, and reads each
  with the strict reader. Nothing reads a template from the project folder, the profile folder or
  the network (FR-001): the texts are part of the program, and only the files the index names are.
  A test (contracts/template-file.md, "The index") fails when a file of the folder is not in the
  index, when the index names a file that is not there, when a line's name and file differ, and when
  the lines are not in name order, each with a sentence that says what to write. So a template is
  one file and one line (FR-022, SC-009 as reworded on 2026-11-17).
- **Why this form** (probed in the scratchpad, `index/`, with Bun 1.4.4 and the CLI's compiler
  options):
  - `with { type: "text" }` hands over the file's bytes as a string, so the strict reader sees what
    the contributor wrote (a key written twice, the lines). Under `bun src/main.ts`, `bun test` and
    `bun build --compile` (the binary run from `/`) each entry gave the file's exact text, and `tsc`
    (5.9.3, `"module": "Preserve"`) passed.
  - **A re-export does not work**: `export { default as postgres } from "./postgres.json" with {
    type: "text" }` gave the JSON already parsed by Bun (an object, not the text), and
    `Bun.Transpiler#transformSync` dropped the attribute. The strict reader would never see the file.
  - **Static imports** (`import postgres from "./postgres.json" with { type: "text" }`) work too,
    but each template is then named twice (the import, and the list), against "one line".
  - The dynamic import with a written-out path is what `bun build --compile` bundles, and what the
    layering test already accepts: `scanImports` reports each as a `dynamic-import` of
    `./<name>.json`, and `hiddenLoadsOf` finds a plain string as its first argument. The module
    awaits its imports at load (top-level await), which Bun supports in the program and the binary.
  - Prettier at 80 columns keeps each line of the first set on one line; a name of more than about
    twelve characters makes it wrap, which changes nothing but the look.
- **The layering test** (`test/layers/layers.test.ts`) refuses any file of `src` that is not
  `.ts` or `.tsx` or a data file it names. `DATA_FILES` gains the rule "every
  `templates/files/<name>.json` whose name is a template's", once, instead of a line per file. Nothing
  else in it changes: no special case.
- **Alternatives considered.** A Bun macro that reads the folder when the CLI is bundled (probed: it
  worked under `bun run`, `bun test` and `bun build --compile`, its code did not ship, and a changed
  file was read again on the next run): one file and no line, but a new mechanism, and the layering
  test would need a special case because `transformSync` throws on a macro import. The maintainer
  chose the index. Reading the folder at run time: it works from source and not in the compiled
  binary. `bun build --compile` with the files as extra entry points and `Bun.embeddedFiles`: two
  paths, source and binary. A generated `.ts` file: a build step that can go stale.

## R2. The template file, and how it is read **(maintainer: the board `TemplateFile`; data read strictly, known fields only, never code; `asks` kept and refused)**

- **Decision.** The format is the board's: `template`, `name`, `title`, `about`, `software`,
  `author`, `also`, `services`, `makes`, `offers`, `notes`, and `asks` (reserved, refused by its
  presence). The full grammar, the order of checks and every rule with its sentence are
  [contracts/template-file.md](./contracts/template-file.md).
- **Reusing the settings reader.** The file is read by `readJson` (`settings/json.ts`: strict
  RFC 8259, the line of every key, duplicate keys refused at every depth, depth at most 6, strings
  at most 4,096 characters, numbers kept as written). The `services` part is then checked by the
  settings file's own steps 3 to 6 (contracts/settings-file.md of feature 010, "The order of
  checks"), so it can say nothing a settings file cannot (FR-003): `settings/schema.ts` exports
  `checkSettingsValue(top, lines, numbers)`, which `checkSettings` itself calls after reading the
  JSON, and the template reader gives it a map of `zekno: 1` and the template's `services`. The keys
  of `services` sit at the same places in both files (`services.<svc>.<section>...`), so the lines
  the settings sentences name are the template file's own lines. A settings fault's place
  (`db, source.image`) is said as a path of the template file (`services.db.source.image`): `, `
  becomes `.` and `services.` goes in front.
- **Rules a settings file does not have.** The image pinned by digest, with a tag, and of an allowed
  publisher; no published port; every secret a template's service reads is made by the template;
  every made secret is read by one of its services; the connection secrets (`offers`) are built only
  from made secrets and `{service}`; a note that says Zekno does not back up the data when a service
  keeps data in a volume; `software` is the first service's image tag. Each has an id and a sentence
  in the contract.
- **Limits.** A file at most 16 KiB (the largest of the first set is 1.4 KiB); 1 to 8 services;
  1 to 16 made secrets of 24 to 64 characters; 0 to 4 connection secrets of at most 512 characters;
  1 to 8 notes of at most 200 characters; at most 8 other names in `also`.
- **Placeholders.** In an offer, `{service}` is the name the template's first service gets in the
  app, and `{NAME}` a made secret's value. Made and offered names are capital letters, digits and
  underscore, so `{service}` can never be read as a secret's name. Every `{` of an offer opens one of
  these; nothing else is computed (FR-003a).
- **Alternatives considered.** A file of its own grammar for services: a second set of rules to keep
  in step with the settings file, against FR-003. Writing the services part back to JSON text and
  calling `checkSettings`: the lines would be the new text's, not the file's, and a number's text
  could change.

## R3. The four official images **(maintainer: PostgreSQL, MySQL, MongoDB and Redis, each the software's official image)**

Tags and digests were read from Docker Hub's public tag list on 2026-11-17, the platforms with
`docker buildx imagetools inspect`, each image pulled by digest, its configuration read with
`docker image inspect`, and its entrypoint copied out and read.

| Template | Image, as the template names it | Tag points at | Linux platforms in the index |
|---|---|---|---|
| postgres | `postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc` | `18`, `latest` | amd64, arm64/v8 (and 386, arm/v5, arm/v7, ppc64le, riscv64, s390x) |
| mysql | `mysql:9.7.4@sha256:df90258da46f6e7ff8574ff84f17618aba0765cac749928299c69fd4e7cb8ad8` | `9.7`, `lts` | amd64, arm64/v8 |
| mongodb | `mongo:9.0.8@sha256:b0c835c26e5997413e985000f1013c275377cd9607761c1784d486f6dd620b7f` | `9.0`, `latest` | amd64, arm64/v8 |
| redis | `redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53` | `8.10`, `latest` | amd64, arm64/v8 (and the same six others as postgres) |

- **Which version.** The newest release of the line each project supports for new work today: the
  newest PostgreSQL 18; MySQL's long-term line, which its `lts` tag names (9.7; the boards' 8.4 was
  an example, and `latest` is 26.10, an innovation release); MongoDB 9.0, its newest major release;
  Redis 8.10, the newest stable release (8.12 is a release candidate). Each digest is the index of
  the tag's variant with no suffix (Debian or Ubuntu based; Oracle Linux for MySQL), so one name runs
  on x86-64 and ARM servers alike. The redrawn boards show these versions as people name them,
  PostgreSQL 18.7, MySQL 9.7, MongoDB 9.0, Redis 8.10: that is each template's `software`, and the
  image's tag is that version or starts with it and a dot (TF30).
- **What each image's configuration says** (`docker image inspect`):

  | Image | Entrypoint, command | Declared volumes | Exposed ports |
  |---|---|---|---|
  | postgres 18.7 | `docker-entrypoint.sh`, `postgres` | `/var/lib/postgresql` (data in `/var/lib/postgresql/18/docker`) | 5432 |
  | mysql 9.7.4 | `docker-entrypoint.sh`, `mysqld` | `/var/lib/mysql` | 3306, 33060 |
  | mongo 9.0.8 | `docker-entrypoint.sh`, `mongod` | `/data/db`, `/data/configdb` | 27017 |
  | redis 8.10.3 | `docker-entrypoint.sh`, `redis-server` | none (works in `/data`) | 6379 |

- **What each entrypoint does with a password** (read, not guessed):
  - **postgres** (`entrypoint`, lines 92 to 133, 235 to 262, 330 to 389): `POSTGRES_PASSWORD` is
    given to `initdb` through `--pwfile=<(printf ...)`, a descriptor, never an argument; with an
    empty password and no `POSTGRES_HOST_AUTH_METHOD=trust` it stops with an error; it adds
    `host all all all scram-sha-256` to `pg_hba.conf`; it runs only on an empty data folder, and
    unsets every `POSTGRES_*` variable before it starts the server. **Since 18, the data is in
    `/var/lib/postgresql/18/docker`, and a volume mounted at `/var/lib/postgresql/data` (as the
    boards show) makes the entrypoint refuse to start** ("unused mount/volume", lines 248 to 261).
    The template mounts its volume at `/var/lib/postgresql`, the image's declared volume.
  - **mysql** (lines 139 to 164, 230 to 345): one of `MYSQL_ROOT_PASSWORD`,
    `MYSQL_ALLOW_EMPTY_PASSWORD` or `MYSQL_RANDOM_ROOT_PASSWORD` is required on an empty data folder;
    the passwords reach the client through a here-string and `--defaults-extra-file=<(...)`, never an
    argument. `MYSQL_RANDOM_ROOT_PASSWORD` **prints the password it makes to the log** (line 273,
    `GENERATED ROOT PASSWORD: ...`), so the template makes the root password itself.
  - **mongo** (lines 248 to 270, 371 to 415): with both `MONGO_INITDB_ROOT_USERNAME` and
    `MONGO_INITDB_ROOT_PASSWORD` set it adds `--auth` on every start; with one of them empty it stops
    with an error on every start, not only the first. The root user is made through `mongosh`'s
    standard input. Only a root user can be made without an init script, and an init script would
    need a folder mounted from the server, which settings cannot say.
  - **redis**: no variable for a password (R4). The entrypoint drops to the `redis` user with
    `setpriv` and, when a configuration file is named, leaves it as it is when `redis` can read it.

## R4. Each template's exact settings, proven with real Docker **(maintainer: the Redis way, approved on 2026-11-17)**

- **Decision.** The four files of [contracts/template-file.md](./contracts/template-file.md),
  "The first set", byte for byte. In short:

  | Template | Service | Made (32 letters and digits each) | Plain | Offers | Volume |
  |---|---|---|---|---|---|
  | postgres | `postgres`, restart always, port 5432 | `POSTGRES_PASSWORD` | `POSTGRES_USER=app`, `POSTGRES_DB=app` | `DATABASE_URL` = `postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app` | `data` at `/var/lib/postgresql` |
  | mysql | `mysql`, restart always, port 3306 | `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | `MYSQL_USER=app`, `MYSQL_DATABASE=app` | `DATABASE_URL` = `mysql://app:{MYSQL_PASSWORD}@{service}:3306/app` | `data` at `/var/lib/mysql` |
  | mongodb (also `mongo`) | `mongodb`, restart always, port 27017 | `MONGO_INITDB_ROOT_PASSWORD` | `MONGO_INITDB_ROOT_USERNAME=app` | `MONGODB_URI` = `mongodb://app:{MONGO_INITDB_ROOT_PASSWORD}@{service}:27017/app?authSource=admin` | `data` at `/data/db` |
  | redis | `redis`, restart always, port 6379, the start command below | `REDIS_PASSWORD` | none | `REDIS_URL` = `redis://default:{REDIS_PASSWORD}@{service}:6379` | `data` at `/data` |

  The postgres row is the board's. What the boards do not show (MySQL's and MongoDB's settings, the
  names `MONGODB_URI` and `REDIS_URL`'s form, the note for MongoDB's administrator user) was
  approved by the maintainer on 2026-11-17 (plan.md, D4 to D6).
- **The Redis start command (approved 2026-11-17)**, exactly:

  ```text
  sh -c 'umask 077 && printf "requirepass %s\n" "$REDIS_PASSWORD" > /tmp/auth.conf && chown redis /tmp/auth.conf && exec docker-entrypoint.sh redis-server /tmp/auth.conf'
  ```

  It runs without a shell on the developer's machine and on the server (feature 010): the
  container's own `sh` reads it. It passes the settings rules (the `$` is inside single quotes), and
  `composeText` writes the `$` as `$$`, so Compose leaves `$REDIS_PASSWORD` for the container's `sh`
  to read from the secret variable. The password is made of letters and digits only, so `printf`
  writes it into the configuration line as it is.
- **The probe** (`run.sh`, real `zekno settings compose`, real Docker): each template's service and a
  client service `app` of the same image (start command `sleep infinity`) that reads the connection
  secret. The client takes the connection secret from its environment and splits it with the
  shell's own parameter expansion, so the password went into `PGPASSWORD`, an option file, `mongosh`'s
  `process.env` or `REDISCLI_AUTH`, never an argument.

  | | postgres | mysql | mongodb | redis |
  |---|---|---|---|---|
  | Compose text | 626 bytes, made by `zekno settings compose` | same way | same way | 731 bytes |
  | Client connected with the connection secret after | 2 s, as `app` to `app` | 7 s, as `app@%` to `app` | 3 s, as `app@admin` to `app` | at once (`PONG`) |
  | A wrong password | refused | refused | refused | refused |
  | No password at all | (a host connection needs one: `scram-sha-256`) | (same) | refused (`listCollections`) | refused (`NOAUTH`) |
  | A command line holding the password, of every process in the container (`/proc/*/cmdline`) | none of 10 | none of 2 | none of 2 | none of 2 |
  | Process 1 | `postgres`, user 999 `postgres` | `mysqld`, 999 `mysql` | `mongod --auth --bind_ip_all`, 999 `mongodb` | `redis-server *:6379`, 999 `redis` |
  | Port published on the machine | none | none | none | none |
  | Mounts | named volume at `/var/lib/postgresql` | named volume at `/var/lib/mysql` | named volume at `/data/db`, and an anonymous one at `/data/configdb` (declared by the image; a server that is not part of a sharded cluster leaves it empty) | named volume at `/data` |
  | `docker compose stop` | 0.2 s, exit 0 | 1.2 s, exit 0 | 0.2 s, exit 0 | 0.2 s, exit 0 |
  | Started again from its volume, client connected again | yes | yes | yes | yes; a key saved, the container removed and made again, the key still there; `CONFIG GET dir` is `/data` |
  | The secret empty (a deploy without it) | stops: "Database is uninitialized and superuser password is not specified." | stops: "Database is uninitialized and password option is not specified" | stops at every start: "missing 'MONGO_INITDB_ROOT_USERNAME' or 'MONGO_INITDB_ROOT_PASSWORD'" | stops: "FATAL CONFIG FILE ERROR ... wrong number of arguments" |

  For Redis, `/tmp/auth.conf` was owned by `redis` with mode 600. Every template fails closed when
  its password is missing: none starts open. That matters for the one window adding cannot close
  (R7).
- **Rationale.** The smallest settings that give an app a working database with a password made on
  the developer's machine, no port published, data in a named volume, and the image's own way of
  starting. Each user and database is named `app`, as the board's postgres.
- **Alternatives considered.** `redis:8-alpine` (the variant the first proof used): smaller, but the
  other three use their default variant, and the default variant was proven the same way.
  `MYSQL_RANDOM_ROOT_PASSWORD`: prints the password to the log. A MongoDB init script for a user
  that is not the administrator: needs a folder of the server. Valkey: refused by the maintainer.

## R5. Volume names, and why the boards' `data` cannot be used as it is

- **Finding.** A Compose volume belongs to the whole app (the project): `composeText` writes one
  top-level `volumes:` entry per name and every service that mounts the same name shares it
  (`settings/compose.ts`, `composeText`, which keeps each name once). The boards add each template's
  volume as `data`. Adding postgres and then mysql would mount one volume at `/var/lib/postgresql`
  and at `/var/lib/mysql`; adding postgres to an app whose `web` already keeps uploads in `data`
  would put the database in the uploads volume. Both are silent and both lose data.
- **Decision (D1, approved).** A template names its volumes for itself (`data`, as the board's file
  does), and adding it names each `<service>-<volume>` in the app: `postgres-data`, or `db-data`
  with `--name db`. A volume of that name already in the app is refused with a sentence of its own.
  Approved by the maintainer on 2026-11-17; the redrawn boards show `postgres-data` in
  `AddTemplate`, `--show` and the hand-written lines, and `TemplateFile` says the volume `data`
  becomes `postgres-data` in the app.
- **Rationale.** The service name is already unique in the app, so the volume name is too; a
  service removed and added again under another name starts with an empty volume, as the spec's last
  edge case says.
- **Alternatives considered.** Template files naming their volumes uniquely (`postgres-data` in the
  file): unique between templates, but every contributor must follow a naming rule, the board's file
  changes, and `--name db` still gives `postgres-data`. Refusing any `data` already in the app:
  postgres and redis could not be in one app.

## R6. Made secrets

- **Decision.** A made secret is a password of `length` characters (24 to 64; the first set uses
  32, about 190 bits) drawn from the 62 letters and digits, from `crypto.getRandomValues` (the
  system's random source through Web Crypto, built into Bun), one byte at a time, bytes of 248 and
  above thrown away so every character is equally likely. Letters and digits only, so it is safe
  inside a URL, a configuration line and a shell's double quotes. The only other kind of value is a
  connection secret, the offer's text with each `{NAME}` replaced by that made value and `{service}`
  by the service's name.
- **Where a value goes.** Made in `ops/add-commit.ts` after the question and after the checks that
  the file and the secret store are unchanged, inside the one function that seals them; handed to
  `createSecret` (`@workspace/core`, unchanged) inside one `withSigner`; never returned, put in a
  plan, an error, a line, a log, a file other than its sealed record, or an argument. A JavaScript
  string cannot be wiped; the values live in that function's local variables only, and nothing keeps
  a reference after it returns (FR-006, "not kept in memory longer than needed", is met as far as
  the language allows; plan.md, Risks).
- **Shown.** As `32 random characters` and, in a connection secret, `••••` in place of each made
  value: `postgres://app:••••@postgres:5432/app` (board).
- **Alternatives considered.** `crypto.randomBytes` with base64: characters a URL or a configuration
  line would need to escape. Hex: a longer value for the same strength.

## R7. All or nothing **(spec FR-008, SC-004)**

The settings file is in the project folder and the secret store in the profile folder: no single
write covers both. The order:

1. Everything is checked and nothing is written: the template, the folder's file, the app and the
   server, the store, every clash, the settings with the service added checked whole.
2. The question, or `--yes`.
3. The settings file's bytes are read again and compared with the SHA-256 read in step 1 (the
   board's "changed while this was open", said before the keychain is touched); the app's secret
   store is read again and compared with the one read in step 1.
4. The values are made (R6) and every record sealed and signed inside one `withSigner`. A failure
   here (the keychain refused, a signing error) writes nothing.
5. **The settings file** is written: `writeSettings` (feature 010: a new file beside it, flushed,
   the old one checked unchanged, then a rename). A failure here (changed meanwhile, a link, a
   read-only folder) leaves the old file as it was; the sealed records are dropped; nothing was
   written.
6. **The secret store** is read again, compared with step 1's once more, and written with every new
   record in one write (`team.store.saveSecrets`: a new file and a rename). A failure here undoes
   step 5: `restoreSettings` puts the file's old bytes back with the same steps as a write, and only
   while the file is still exactly the one step 5 wrote (its SHA-256). If that cannot be done, the
   sentence says what is left, and how to take it away (AD19).
7. Nothing else is written. Nothing is deployed.

- **Why the settings file first.** Its write is the one with several ways to fail that a person
  meets (the file changed in an editor, a link, a folder made read-only), and each leaves nothing to
  undo when nothing was stored yet. The store's write fails only when the profile folder cannot be
  written, and undoing the settings file then uses checks that already exist (a compare by SHA-256
  and a rename). Undoing the store instead would mean writing a store file where none was, or
  removing one: neither is "exactly as it was".
- **The window that cannot be closed.** A process ended between the rename of step 5 and the rename
  of step 6 (a power cut, `kill -9`) leaves the service in the file without its secrets. The next
  deploy at a terminal asks for the missing values, as for any settings file; in a script it deploys
  without them, and each of the four images then refuses to start (R4), so nothing runs open. The
  docs say how to finish by hand: remove the service, or set its secrets. The window is two renames
  long.
- **Alternatives considered.** The store first and the file second: a failed file write (the common
  case) would need the store undone. A lock file: no portable lock covers an editor, as feature 010's
  research R5 found for the settings file alone.

## R8. Which file, which app, and when there is no server **(maintainer: the same rule as `zekno settings`; with no server, say to run `zekno deploy` first)**

- **Which file.** `zekno add` adds to the file `zekno deploy` in this folder would sign, decided by
  the deploy's own rule as the settings commands decide it (`settingsPlace`, `settings/source.ts`;
  `readPlaced` in `ops/settings.ts`, with SH4 for a `zekno.json` not in use here yet). `readPlaced`
  is split so that `zekno add` gets the Compose case as an answer, not as the SH2 or SH3 error:
  `findPlace(deps)` gives settings, a Compose file, or none, and `readPlaced` keeps its behaviour on
  top of it. A Compose file is the hand-written path (R10); none is AD13.
- **Which app and server.** As `zekno secret set`: `--app`, `--server`, the folder's `zekno.json`
  when the team signed it and it is in use here, then at a terminal a question for each (`details` in
  `cli/cli.ts`). With no profile, or a profile with no server, `zekno add` says AD1 before anything
  else is asked or read: a secret cannot be sealed for a server that is not there.
- **No team needed to look.** `--list` and `--show` read the catalogue only: no profile, keychain,
  file, server or network (FR-013). `add` joins `WITHOUT_TEAM` so A3 is never said for it.

## R9. Options, and keeping every other command as it is **(spec FR-019, SC-006)**

- **Decision.** `parseArgs` gains `for` (a string, `multiple: true`), `list` and `show` (booleans).
  `--name`, `--app`, `--server`, `--yes` and `--json` exist already. `zekno add` takes only these
  eight; any other option given to it is refused as the settings commands refuse one
  (`optionNotTaken`, status 2 with the help line).
- **The three new options on another command.** Today `zekno deploy --list` fails in `parseArgs`
  with Node's own "Unknown option" sentence and status 2. To keep that exactly, when the command is
  not `add` and one of the three is given, `run` parses the arguments again with the option table as
  it was, and that throws the very error it always threw. `plain-unchanged.test.ts` gains a scene for
  it; `plain-at-head.ts` is not edited.
- **Alternatives considered.** A parser of `zekno add`'s own: two parsers to keep alike. A new
  sentence for the three options elsewhere: a change of output for scripts (FR-019).

## R10. The lines for a hand-written Compose file **(maintainer: never edit it; print the lines and say where they go)**

- **Decision.** The board's form: Compose's short syntax, the template's service under `services:`,
  plain values before secrets, `${NAME}` for each secret, the volume as `- <volume>:<path>`, its name
  under `volumes:`, and `      <OFFER>: ${<OFFER>}` for each service that uses the connection secret.
  A value is written bare, as the board writes `app` and `always`, only when it starts with a letter,
  holds only letters, digits and `._/:@-`, and is not one of YAML 1.1's words for true, false or
  null (`y`, `yes`, `n`, `no`, `on`, `off`, `true`, `false`, `null`, in any case); anything else is
  written with `quote` (`settings/compose.ts`), as `composeText` writes it. A start command is always
  a flow list of `quote`d words.
- **Why `$` must be doubled there too.** Probed with `docker compose config`: with the Redis start
  command written with a single `$` in a hand-written file, Compose replaced `$REDIS_PASSWORD` with
  the value from its environment, so the password would be on the command line of `sh` and of the
  process that runs it; written `$$` (as `quote` does) it stayed `$$REDIS_PASSWORD` for the
  container's `sh`. The boards draw only postgres's lines, which need neither.
- **The image** is printed whole, with its digest: a person copies it into a file (the boards
  shorten it to `4f1c…a9e2` for room).
- **Alternatives considered.** Printing `composeText`'s lines: correct, but not the board's form
  and not what a person writes by hand. Reading the person's Compose file to look for clashes: zekno
  would be judging a file it does not otherwise read.

## R11. The screens **(maintainer: the boards, binding)**

- **What exists.** The deploy summary's box (`Panel` and the field rows of `ui/parts/`), the
  yes-or-no question (`Ui.confirm`), the one-row list (`ListPrompt`), `ErrorLine` for `✖` and a dim
  second sentence, the settings report's section grid (`ui/ink/settings-report.tsx`: sections 14
  columns wide, labels from column 16, values from column 26).
- **What is new.** A list to pick several rows from (`◉`/`◯`, `space pick`, `enter done`), built
  like `ListPrompt` from `listWindow`, `QuestionLine`, `isCtrlC`; a middle column in a one-row list's
  row (the picker's `PostgreSQL 18.1`); the drawings of the summary, the list, `--show`, the
  hand-written lines and the result. No new colour: brand, success, warning, danger, dim, bold, the
  text colour (`ui/terminal/theme.ts`). The boards' white that is not bold (`data` in `data kept in
  volume data`) is the terminal's text colour: the theme has nothing brighter that is not bold.
- **Columns.** The board's 190 px name column with its 8 px gap and 17 px indent put values at
  column 26 and names at column 2, as feature 010's settings report: the same grid.

## R12. The template tests, and Docker **(spec FR-023, SC-008, SC-010)**

- **Decision.** `bun test` runs, for every file of `templates/files/` and with no Docker: the
  reader (form and settings rules), the image pinned and its publisher allowed, no published port,
  data in a named volume. `bun run test:templates` (in `apps/cli`: `ZEKNO_TEMPLATES_DOCKER=1 bun test
  test/templates`) runs the same and, when `docker info` answers, starts each template's service from
  its own Compose text with made secrets, under project `zekno-test-template-<name>`, and checks it
  as R4's probe did: running after its start without restarting, no published port, its data folder
  a named volume, no command line in the container holding a made value (`docker top`, compared, never
  printed), and a client connecting with the connection secret; then removes it with its volumes.
- **The client check needs to know the software.** Each kind of database speaks its own protocol.
  `test/templates/clients.ts` holds a client for each of the first set (as the probe's), keyed by
  template name. A new template without one gets every other check and a skipped test that says the
  reviewer connects by hand (plan.md, D23); a contributor may add a client there, which is code and
  is reviewed as code.
- **Test names.** As the board: `<name> form, settings rules, image pinned, publisher allowed`,
  `<name> no published port, data in a volume`, `<name> starts with Docker, a client connects`. A
  failing file fails with the sentence `<name> <place>: <rule>`. The marks and times are `bun test`'s
  own reporter's.
- **End to end (SC-008).** `test/scenarios/templates-real-docker.test.ts`: `zekno add <name> --yes`
  in a folder with a settings file, then `zekno deploy` through the local runner with real Docker
  (`ready({ realDocker: true })`), then the client service reaches the database by its service name
  with the connection secret, for each of the four. Skipped unless Docker answers and the four images
  are in the local image store, so a plain `bun test` never pulls.

## R13. The check on GitHub **(maintainer: one workflow, `pull_request`, no secret, actions pinned, `contents: read`, `persist-credentials: false`)**

- **Decision.** `.github/workflows/pull-request-checks.yml`, given whole in
  [contracts/contributing.md](./contracts/contributing.md). It runs on `pull_request` only (a pull
  request from a fork gets a read-only token and no secret), with `permissions: {}` at the top and
  `contents: read` on its one job, the same two actions pinned to the same full commits as
  `main-versions.yml` and `runner-release.yml`, the Bun version read from `package.json` as they read
  it, `bun install --frozen-lockfile --ignore-scripts`, then `bun run typecheck`, `bun run lint`,
  `bun run test` from the root, and `bun run test:templates` in `apps/cli`. GitHub's Ubuntu runner has
  Docker, so the Docker part runs there and pulls the pinned images from Docker Hub.
- **What it cannot do.** A pull request can change the workflow and the tests too, and the check
  runs the pull request's own copy: it proves that a pull request passes its own checks, not that
  it left them alone. The reviewer reads every file a pull request changes; one that touches
  anything but a template file is reviewed as code (contracts/contributing.md, CG8). Making the check
  required, and asking for approval before a first-time contributor's workflow runs, are settings of
  the repository: the maintainer's steps.
- **Alternatives considered.** `pull_request_target`: runs with the base repository's token and
  secrets beside a fork's code, refused by the maintainer.

## R14. The docs page built from the files **(spec FR-026)**

- **Decision.** `apps/web/content/docs/templates.mdx`, a page that lists the templates with a
  component, `<TemplateList />` (`apps/web/modules/docs/components/templates.tsx`, a Server
  Component), which reads `apps/cli/src/templates/files/*.json` once at module scope with
  `fs.readFileSync` and shows each one's name, what it is, the software's version and its author.
  The installed Next.js guide (`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`,
  "Predictable values") says module-scope synchronous reads complete during prerender and become part
  of the static page; the docs pages are all prerendered (`generateStaticParams`). It reads only the
  fields it shows, with a small zod object, and React escapes them. A test in `apps/web` checks the
  list holds every file.
- **Risk.** The build must see `apps/cli` beside `apps/web`, as a monorepo checkout does. Stated in
  plan.md, Risks.

## R15. Where the spec, the boards and the code disagreed, and how each was settled

Found while planning; the maintainer answered on 2026-11-17, and the boards, the spec and these
documents were changed to match.

1. The boards' volume `data` would be shared by every service of an app that mounts `data` (R5).
   Settled: `<service>-<volume>` in the app (D1); the boards now show `postgres-data`.
2. The boards' Postgres path `/var/lib/postgresql/data` makes the 18 image refuse to start (R3).
   Settled: `/var/lib/postgresql` (D2); the boards now show it.
3. FR-002 said "published by the software's own publisher". Docker Official Images are built and
   published by Docker's official-images programme with each project's maintainers (MySQL's by
   Oracle, Redis's by Redis); PostgreSQL's and MongoDB's are kept by the docker-library maintainers.
   Settled: FR-002 now says a Docker Official Image, from a list of allowed sources kept in the
   repository (`templates/publishers.ts`).
4. FR-016 asks what is shown before adding to say the image changes only with a new CLI; the board
   `AddTemplate` shows only "pinned by digest". `--show` and the docs say it; the summary is built as
   drawn (approved with D8 to D33).
5. The board put "changed while this was open" and "no settings file" under exit status 2, where
   `zekno settings` says status 1 (CS12, SH1). Settled: status 1, as `zekno settings` (D27); AD21, a
   store changed while the question was open, is the same kind and is 1 too. The board `AddOther` now
   says so.
6. The board `TemplateFile` says a file "cannot publish a port, because settings cannot say those";
   settings can (`networking.publish`). A template rule refuses it (TF24); the guide says it
   correctly (CG9).
7. A generic "a client connects" for any future template is not possible (R12, D23, approved).
8. The format allows several services, but nothing said what `{service}` and `--name` mean then
   (R2: the first service; D19, approved).
9. SC-009 ("exactly one file") could not hold without a new mechanism (R1). Settled: an index file;
   FR-022 and SC-009 now say one file and one line in the index.
10. Two different templates that offer the same connection secret (postgres and mysql both offer
    `DATABASE_URL`) cannot both be added to one app (AD5). Accepted for this version (D7); the docs
    say so.
11. The spec's last edge case ("a renamed service starts with an empty one") holds with D1.
12. The boards show each version as people name it (MySQL 9.7, MongoDB 9.0, Redis 8.10) where the
    image's tag names the release (`9.7.4`, `9.0.8`, `8.10.3`). Settled by the redrawn boards:
    `software` is the version as shown, and the first service's image tag must be it or start with
    it and a dot (TF30).
13. Still on the redrawn boards: the shortened digests (`2ea8…1bbc`) in `AddLook` (`--show`),
    `AddOther` and `TemplateFile`, where zekno prints them whole (D25, approved); and `AddLook`'s
    right column, "The numbers here are examples", though they are now the real ones. Both are the
    boards' own and change nothing that is built.

## R16. What was run, and what was only read

- **Run**: the macro and index probes (R1) under `bun run`, `bun test`, `bun build --compile`,
  `tsc` and Prettier; `Bun.Transpiler` on the importing files; Docker Hub's tag list; `docker buildx imagetools inspect`;
  four pulls by digest; `docker image inspect`; the four entrypoints copied out; `run.sh` eight times
  (each template with a made password and with an empty one) with the real `zekno settings compose`
  and real Docker; `docker compose config` on a hand-written file with `$` and `$$`; the clean-up
  checks.
- **Read only**: the code of `apps/cli` this plan builds on, feature 010's documents, the four
  boards, the workflows, the Next.js guide named in R14, the Bun guide on macros
  (`node_modules/.bun/bun-types@1.4.4/node_modules/bun-types/docs/bundler/macros.mdx`).
- **Not run**: the repository's `bun test`, `typecheck`, `lint` (no code was written), any
  GitHub workflow, `next dev`, `next build`.
