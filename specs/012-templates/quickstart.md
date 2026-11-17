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
| edit `zekno.app.json` while the question is open, then `y` | AD8 (2), nothing added |
| an empty folder | AD13 (2) |
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

`bun run test:templates` with Docker (T036). Results:

_Not run yet._

## Real Docker

`bun test test/scenarios/templates-real-docker.test.ts` with the four images pulled (T031). Results:

_Not run yet._

## One file is one template

T042's proof. Results:

_Not run yet._

## The check on GitHub

The tests read for what assumes macOS (T039), and the first pull request's run of
`pull request checks`. Results:

_Not run yet: the workflow runs once the maintainer opens a pull request._

## The pseudo-terminal walkthrough

Each board against the real program (T056). Results:

_Not run yet._

## Checks at the end

T057. Results:

_Not run yet._

## Verified while planning (2026-11-17)

Recorded in research.md, R1, R3, R4, R10 and R16: the macro under `bun run`, `bun test`,
`bun build --compile` and `tsc`; the four images' tags, digests, platforms and entrypoints; each
proposed template turned into Compose text by the real `zekno settings compose` and started with
real Docker (a client connected with the connection secret, a wrong password and no password were
refused, no command line held the password, no port was published, the data was in a named volume,
each stopped cleanly and started again from its volume, and each refused to start with an empty
password); the Redis start command exactly as approved; `docker compose config` on hand-written
lines with `$` and `$$`. Every probe container, network and volume was removed.
