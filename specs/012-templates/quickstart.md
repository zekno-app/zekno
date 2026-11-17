# Quickstart: checking templates

How to see that `zekno add` works, scenario by scenario. The exact lines are in
[contracts/commands.md](./contracts/commands.md); the file's rules in
[contracts/template-file.md](./contracts/template-file.md); the tests, the check and the docs page
in [contracts/contributing.md](./contracts/contributing.md). Results are added below as tasks
complete.

## Before you start

- In `apps/cli`, with `bun install` done at the root.
- Always a profile folder of the session's own: `export ZEKNO_HOME="$(mktemp -d)"`. Never
  `~/.zekno`, never the real keychain (the tests use `memoryKeyStore()`).
- A server for adding: the local runner, as the tests' `ready()` sets it up
  (`test/support/helpers.ts`), or `zekno server add dev --local --home "$(mktemp -d)"`. No `ssh`, no
  remote server, no port 3000 or 3100.
- Docker only for the template tests and the real Docker run. Every Compose project is named
  `zekno-test-template-<name>` or `zekno-<a temporary app>`, publishes no port, and is removed with
  its volumes (`docker compose -p <project> down -v`).

## 1. Look before adding (US2)

```bash
bun src/main.ts add --list                    # four lines, from column 2, no team needed
bun src/main.ts add --list | cat              # postgres	PostgreSQL	18.7	zekno ...
bun src/main.ts add --list --json             # {"templates":[...]}
bun src/main.ts add postgres --show           # the board AddLook's middle column
bun src/main.ts add mongo                     # ✖ There is no template named mongo. / Run zekno add mongodb. (status 2)
```

Expected: each works in an empty folder with an empty `ZEKNO_HOME`; nothing is created in either.

## 2. Add a database to a settings app (US1)

In a folder with a `zekno.app.json` of one service `web` (`zekno settings init`), linked to app
`demo` on server `dev`:

```bash
bun src/main.ts add postgres      # the summary, then: ? Add postgres to demo? ... (y/N)
```

Expected after `y`: `✔ Added postgres to zekno.app.json`, `✔ Stored POSTGRES_PASSWORD and
DATABASE_URL, sealed for dev`, `Run zekno deploy to start it.`; `zekno settings` shows the new
service with its volume `postgres-data`; `zekno secret ls` lists both secrets, version 1, not
deployed; no value appears anywhere. `zekno settings compose` prints the text the next deploy signs.

With a second service `worker`: the question `Which services read DATABASE_URL?` comes first.

## 3. Refusals

| Do | Expect (status) |
|---|---|
| `add postgres` with an empty `ZEKNO_HOME` | AD1 (2) |
| `add postgres` again | AD6 (2) |
| `add postgres --name db` after the first | AD5 for `POSTGRES_PASSWORD` (2) |
| a `web` with a plain `DATABASE_URL`, then `add postgres` | AD7 (2) |
| edit `zekno.app.json` while the question is open, then `y` | AD8 (1), nothing added |
| an empty folder | AD13 (1) |
| `n`, Esc or Ctrl-C at the question | `Nothing was added.` (1) |

## 4. Whole or not at all (SC-004)

```bash
bun test test/ops/add-commit.test.ts
```

A failure at each step leaves the file's and the store's bytes as they were (step f's own case
says what is left).

## 5. Scripts (US4)

```bash
bun src/main.ts add postgres --app demo --server dev < /dev/null | cat        # AD4 on stderr, status 1
bun src/main.ts add postgres --yes --app demo --server dev < /dev/null | cat  # added / stored / stored
```

## 6. A hand-written Compose file (US3)

In a folder with only `compose.yaml`: `bun src/main.ts add postgres` prints the board `AddOther`'s
lines and asks to make the two secrets. `compose.yaml` is byte for byte as before (`shasum` before
and after). Piped, the lines are bare and nothing is made without `--yes`.

## Template tests

`bun run test:templates` with Docker (T036), and the index test (T010) without it:
`bun test test/templates/index.test.ts`. Results:

Run on 2026-11-17 on macOS 27.0.1 (Apple silicon), Docker Engine 29.6.1, Compose 5.3.0, Bun
1.4.4. The four pinned images were already in the local image store, so nothing was pulled.
`bun run test:templates` (in `apps/cli`: `ZEKNO_TEMPLATES_DOCKER=1 bun test test/templates`), its
last run: 188 pass, 0 fail, 12 files (the workflow's test among them), 70.6 s in all. The lines of the board, as `bun test` reported them (JUnit
report of `test/templates/files.test.ts` and `test/templates/docker.test.ts`, run again on their
own):

| Test | Result | Time |
|---|---|---|
| `postgres form, settings rules, image pinned, publisher allowed` | pass | under 1 ms |
| `postgres no published port, data in a volume` | pass | under 1 ms |
| `postgres starts with Docker, a client connects` | pass | 17.1 s |
| `mysql form, settings rules, image pinned, publisher allowed` | pass | under 1 ms |
| `mysql no published port, data in a volume` | pass | under 1 ms |
| `mysql starts with Docker, a client connects` | pass | 17.1 s |
| `mongodb form, settings rules, image pinned, publisher allowed` | pass | 3 ms |
| `mongodb no published port, data in a volume` | pass | 1 ms |
| `mongodb starts with Docker, a client connects` | pass | 17.9 s |
| `redis form, settings rules, image pinned, publisher allowed` | pass | under 1 ms |
| `redis no published port, data in a volume` | pass | 2 ms |
| `redis starts with Docker, a client connects` | pass | 17.1 s |

Each third line started the template's service under the Compose project
`zekno-test-template-<name>` from the Compose text zekno writes for it, beside a client service `app`
of the same image, with secrets made by `makePassword` and given to `docker compose` through its
environment only; 15 s after `up` each service was running with no restart, no port bound, its data
in the named volume `zekno-test-template-<name>_<name>-data`; `docker top` of every container held
no made value (compared, never printed); the client of `test/templates/clients.ts` connected with
the connection secret, and a wrong password (and for MongoDB and Redis no password) was refused.
Each was removed with `down -v` in a `finally`. Afterwards `docker ps -a`, `docker volume ls` and
`docker network ls` listed nothing named `zekno-test-template-`, and exactly the networks they
listed before the runs; the volumes too, but one anonymous volume of `sessora-fix031-pg`, a
container of another project started meanwhile (the containers that were there before,
`sessora-redis` among them, untouched). The temporary folders of the Compose files are removed
too, and an `afterAll` removes each project again by its name should a run end before its
`finally`. No template here lacks a client, so no line
`<name> a client connects: no client check, the reviewer connects by hand` was skipped. Without
`ZEKNO_TEMPLATES_DOCKER=1`, `bun test test/templates/docker.test.ts` skips the four.

## Real Docker

`bun test test/scenarios/templates-real-docker.test.ts` with the four images pulled (T031). Results:

Run on 2026-11-17 on macOS (Apple silicon), Docker Engine 29.6.1, Bun 1.4.4. The four pinned
images were already in the local image store (`docker image inspect` of each pinned reference
answered), so nothing was pulled: no registry was contacted. For each template, in a temporary
folder whose `zekno.app.json` has one service `app` (the template's own image, start command
`sleep infinity`): `zekno add <name> --yes --app probe-<name>-<pid> --server dev`, then `zekno
deploy` through the local runner with real Docker (Compose project `zekno-probe-<name>-<pid>`),
then the client of research R4 run in `app` with the connection secret from its environment
until it connected, a wrong password tried, and the database's container inspected.

| Template | Client connected (from `zekno add` to the first answer) | Client said | Wrong password | Published ports | Data |
|---|---|---|---|---|---|
| postgres | 2.7 s | `app app` | refused | none | volume `zekno-probe-postgres-<pid>_postgres-data` at `/var/lib/postgresql` |
| mysql | 6.9 s | `app@%  app` | refused | none | volume `zekno-probe-mysql-<pid>_mysql-data` at `/var/lib/mysql` |
| mongodb | 3.3 s | `app@admin app` | refused; no password refused too | none | volume `zekno-probe-mongodb-<pid>_mongodb-data` at `/data/db`, and the image's anonymous volume at `/data/configdb` (D33) |
| redis | 0.4 s | `PONG` | refused; no password refused too | none | volume `zekno-probe-redis-<pid>_redis-data` at `/data` |

The whole file took 20.9 s. `afterAll` ran `docker compose -p <project> down --volumes
--remove-orphans` for each; `docker ps -a`, `docker volume ls` and `docker network ls` afterwards
listed exactly what they listed before the run (nothing of a `probe` project left; the containers
that were there before, `sessora-redis` among them, untouched).

## One file and one line

T042's proof: a copied file is named by TI1 until its line is in the index, then listed, shown and
on the docs page, with no other change. Results:

Run on 2026-11-17, in `apps/cli`:

1. `src/templates/files/postgres.json` copied to `src/templates/files/example-db.json` with `name`
   `example-db` (`also` was `[]` already). `git status` showed that one file, untracked.
2. `bun test test/templates`: 184 pass, 2 fail, both of `test/templates/index.test.ts`. The first
   said exactly:

   ```text
   example-db.json is not in the index. Add this line to apps/cli/src/templates/files/index.ts, in its place by name:
     ["example-db", await import("./example-db.json", { with: { type: "text" } })],
   ```

   The second, `TEMPLATE_TEXTS` against the folder, failed the same way.
3. That line added first in `src/templates/files/index.ts` (its place by name, before `mongodb`).
   `git status --short apps/cli/src` then showed `M apps/cli/src/templates/files/index.ts` and
   `?? apps/cli/src/templates/files/example-db.json`, and nothing else. The line is 80 columns,
   which `bun run format` keeps; a longer name is broken onto several lines by Prettier, which the
   index test reads the same (it allows Prettier's breaks).
4. `bun test test/templates test/layers`: 210 pass, 0 fail, `example-db`'s TT1 and TT2 among them
   (its TT3 needs `ZEKNO_TEMPLATES_DOCKER=1`). Before this proof, two tests of
   `test/templates/catalogue.test.ts` (T011) asserted that the catalogue was exactly the first set
   and failed here; they now assert D8 on whatever the index names (the first set first, in the
   boards' order, then the rest by name), so a contributor changes no test (FR-022). The tests of
   `--list`, `--show` and the picker compare the board's lines exactly while the catalogue is the
   first set, and else word for word. `bun test test/commands/add-looking.test.tsx
   test/ui/ink/templates.test.tsx test/ui/ink/list-column.test.tsx test/ops test/version test/docs`
   with the file in: 148 pass, 0 fail.
5. `bun src/main.ts add --list` with an empty temporary `ZEKNO_HOME`, piped:

   ```text
   postgres	PostgreSQL	18.7	zekno
   mysql	MySQL	9.7	zekno
   mongodb	MongoDB	9.0	zekno
   redis	Redis	8.10	zekno
   example-db	PostgreSQL	18.7	zekno
   ```

   and `bun src/main.ts add example-db --show` printed postgres's piped lines.
6. In `apps/web`, `bun test`: 32 pass, 0 fail; the page's own function, `readTemplateRows()`, gave
   the four and `example-db	PostgreSQL: A relational database.	18.7	by zekno` last.
7. The file and its line removed; `git status --short apps/cli/src` printed nothing.

The tests also give the catalogue one more text (`catalogue(texts)`), which is listed, shown and
added end to end like any other (`test/templates/catalogue.test.ts`, `test/ops/add.test.ts`,
"one file and one line more").

## The check on GitHub

The tests read for what assumes macOS (T039), and the first pull request's run of
`pull request checks`. Results:

**The workflow: not run.** `.github/workflows/pull-request-checks.yml` is the contract's file byte
for byte (`test/templates/workflow.test.ts` checks it, and CW1 to CW8); it runs once the maintainer
opens a pull request. Making `checks` a required check, and asking for approval before a
first-time contributor's run, are the maintainer's settings (MS1, MS2).

**What the tests assume of the machine**, read on 2026-11-17 in every test `bun run test` runs from
the root (`apps/cli/test`, `apps/runner/test`, `packages/core/test`, `apps/web/modules`), looking
for paths under `/private`, a disk that ignores letter case, `security` and the keychain, a home
folder, a fixed port, the platform, and the programs a test starts:

| What | Where | On Linux |
|---|---|---|
| Temporary folders under `/var`, a link to `/private/var` | `test/settings/file.test.ts`, `test/secrets/import-file.test.ts`, `test/project/*`, `test/plain/plain-scenes.ts` | Already portable: each compares through `realpathSync`, or takes `/private` off only where it is there. |
| A disk that ignores letter case | `test/scenarios/settings-exact-name.test.ts`, `test/secrets/import-file.test.ts`, `test/project/project.test.ts` | Already portable: each finds out (a probe file, or `existsSync` of the other case) and checks the case the disk has. |
| The keychain, `security` | none | No test uses the system's keychain: every test gives `memoryKeyStore()` or a keychain that throws. |
| A home folder | `test/app/app-effects.test.ts` (`homedir()`) | Portable: it builds the path from `homedir()` itself. Every other test uses a temporary `ZEKNO_HOME`. |
| A port | `packages/core/test/scenarios/cross-process.test.ts` | Portable: `Bun.serve({ port: 0 })`. No test listens on a fixed port. |
| `/bin/sh` is `dash` on Ubuntu, `bash` on macOS | the stand-in scripts of `test/support/stand-in-server.ts`, the runner's stand-in Docker (`apps/runner/test/support/helpers.ts`), and the installer and check scripts they run | Read: the scripts use POSIX shell only. Run here: `dash -n` parses `INSTALL_SCRIPT` and `CHECK_SCRIPT`, and `bun test test/server` passed (151 tests) with the stand-in server's `sh` pointed at `/bin/dash` for that run only (the support file put back as it was). |
| Shells that may be missing | `apps/runner/test/release/releasing-doc.test.ts` | Portable: it checks each of `/bin/sh`, `/bin/bash`, `/bin/dash`, `/bin/zsh` that exists. |
| `git`, its identity | `apps/runner/test/release/*` | Portable: each run sets `GIT_CONFIG_GLOBAL=/dev/null` and a committer of its own. |
| `uname`, `sha256sum` or `shasum` | `test/server/install/*` | Portable: the stand-in server answers `uname` itself and uses whichever of the two this machine has. |
| `ps -o rss=`, `pgrep -P`, `mkfifo`, `cp -R`, `ls -A` | `apps/runner/test/support/helpers.ts`, `test/scenarios/plumbing.test.tsx`, several | On `ubuntu-24.04` (procps, coreutils). |
| Docker | `test/scenarios/real-docker.test.ts`, `test/scenarios/templates-real-docker.test.ts`, `test/settings/compose-random.test.ts` | The first two are skipped unless Docker answers and the images they need are already in the local store, so `bun run test` on GitHub, which has none of them, pulls nothing. The third runs `docker compose config` where Compose is installed, as it is there: it reads files and contacts nothing. `test/templates/docker.test.ts` runs in the next step, `bun run test:templates`, and pulls the four images by digest. |
| The compiled CLI | `test/compiled/compiled.test.ts` | Portable: built for the machine it runs on, and stops before it would read a keychain. |

Nothing was found that only works on macOS, so no test was changed or skipped for Linux. Not
checked without a Linux run: timing bounds and the memory bound of `test/scenarios/plumbing.test.tsx`
on GitHub's machine, which may be slower; and the first pull request's run is the proof.

## The pseudo-terminal walkthrough

Each board against the real program (T056). Results:

_Not run yet._

## Checks at the end

T057. Results:

_Not run yet._

## Verified while planning (2026-11-17)

Recorded in research.md, R1, R3, R4, R10 and R16: the index of text imports (and the macro first
proposed) under `bun run`, `bun test`, `bun build --compile`, `tsc` and Prettier; the four images' tags, digests, platforms and entrypoints; each
proposed template turned into Compose text by the real `zekno settings compose` and started with
real Docker (a client connected with the connection secret, a wrong password and no password were
refused, no command line held the password, no port was published, the data was in a named volume,
each stopped cleanly and started again from its volume, and each refused to start with an empty
password); the Redis start command exactly as approved; `docker compose config` on hand-written
lines with `$` and `$$`. Every probe container, network and volume was removed.
