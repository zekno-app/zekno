# Contributing Contract: the guide, the template tests, the check on GitHub, the docs page

User Story 5 (FR-022 to FR-026). The board `TemplateFile` (right two columns) is binding for the
words of "How one gets in", "What the reviewer checks by hand" and "Later, not now", and for the
test lines. The maintainer approved one workflow, triggered by `pull_request`, with
`permissions: {}` at the top, `contents: read` on its job, actions pinned to full commits as the
existing workflows pin them, no secret and `persist-credentials: false`.

## The guide: `CONTRIBUTING.md`

At the repository's root, where GitHub links it from every new pull request. Plain short
sentences, "runner" for the program on a server, no em dash. It must contain, in this order:

| Id | Part | What it says |
|----|------|--------------|
| CG1 | What a template is | One data file in `apps/cli/src/templates/files/`, named `<name>.json`, and one line for it in that folder's `index.ts` (the board: "one file, and one line in the index"). It adds one or more services to an app's `zekno.app.json`, with the secrets they need made on the user's machine. It is data, read strictly, never code. It ships inside the CLI with a release; nothing is downloaded when it is used. |
| CG2 | The format | Each field with the board's words ("What each part is": `name, title …` what the list and the docs page show, the author credited; `also`; `services`: `What goes into zekno.app.json. Same format, same checks. Its volume data becomes postgres-data in the app, so no two services share one.`, and that a template may hold several services; `makes`; `offers` with `{service}`; `notes`, backups always named; `asks` kept for the version that brings domains, refused until then), postgres's file as the example, and a link to the full rules (`specs/012-templates/contracts/template-file.md`). |
| CG3 | The rules | Every rule a file must meet, one line each, grouped as the contract groups them: the fields; the services, by the rules of `zekno.app.json`; the image named by version, pinned by digest, from an allowed source (a Docker Official Image); no published port; every secret a service reads made by the template; a connection secret pointing at `{service}` and nowhere else (TF34, security review T5); data in named volumes; the backup note. The index: one line per file, in the order of the names, written as the contract shows it, and nothing else in it (security review T6). And that the tests check every one of them, the index included, and name the rule and the place when one is broken. |
| CG4 | Running the tests | `bun install`, then in `apps/cli` `bun run test:templates`. What each of the three lines of the board means. Without Docker the third is skipped; with Docker it pulls the image and starts it. A template with no client check gets a line that says so (D23), and the contributor says in the pull request how they connected. |
| CG5 | How one gets in | The board's five steps, word for word: `1. Copy a template file, change its values, and add its name to the index, one line.` `2. Run the template tests.` `3. Open a pull request. The tests run again on GitHub, with no access to any secret.` `4. A maintainer reads it and merges it.` `5. It ships with the next release, in zekno add and on the docs page, with its author.` |
| CG6 | What the reviewer checks by hand | The board's four, word for word: `Is it the software's official image?` `Is the description honest about what it does not do?` `Does it need a setting that weakens it?` `A start command that runs a shell: every word of it.` Then the reviewer's own list: the pull request changes the template's file and nothing else (CG8); the digest is the one the tag named on the day it was written (the reviewer looks it up); the connection secret points at `{service}` and nowhere else (security review T5); the version is one the project supports; the author is the person who opened the pull request, or someone who agreed to be named. |
| CG7 | Allowed sources | A template's image is a Docker Official Image; the allowed sources are listed in `apps/cli/src/templates/publishers.ts` (FR-002). A template whose image is from another source fails the tests. Adding a source is the maintainer's decision, in a pull request of its own. |
| CG8 | A pull request that changes more | The check runs the pull request's own copy of the tests and the workflow. So a pull request that changes anything but one template file and its line in the index (a test, a workflow, the code, the allowed sources) is reviewed as code, line by line, and is never merged because the check passed. A client check for a new kind of software goes in `apps/cli/test/templates/clients.ts` and is code. |
| CG9 | What a file cannot do | The board's sentence, corrected: `It is data, read strictly: no code, no unknown field, nothing fetched. It cannot mount a folder of the server or run privileged, because settings cannot say those, and it cannot publish a port, because the template rules refuse it.` |
| CG10 | Later, not now | The board's: `A catalogue of its own, templates from an address, paying authors.` |
| CG11 | Security | A security problem is reported privately (README's "Reporting a vulnerability"), never in a pull request or an issue. |
| CG12 | Licence | A contribution is under the repository's MIT licence; the Zekno name and logo are not. |

## The template tests

`apps/cli/package.json` gains the script `"test:templates": "ZEKNO_TEMPLATES_DOCKER=1 bun test test/templates"`.
Plain `bun test` runs the same files with the Docker part skipped, so it never pulls an image.

For each file of `apps/cli/src/templates/files/`, three tests, named as the board names its lines:

| Id | Test name | What it checks |
|----|-----------|----------------|
| TT1 | `<name> form, settings rules, image pinned, publisher allowed` | The file reads with no fault (contracts/template-file.md, every TR, TF and TS rule, and TC1, TC2 across the folder). |
| TT2 | `<name> no published port, data in a volume` | No service publishes a port; the Compose text of the services as added (`composeText`) has no `ports:` line and every mount is `type: "volume"`; every volume name `<service>-<vol>` passes its rule. |
| TT3 | `<name> starts with Docker, a client connects` | Only with `ZEKNO_TEMPLATES_DOCKER=1` and `docker info` answering, else skipped: research R12's checks, under Compose project `zekno-test-template-<name>`, with secrets made by the CLI's own maker and given to `docker compose` through its environment only; removed with its volumes in every case. The client part needs a client in `test/templates/clients.ts`; without one that part is a skipped test named `<name> a client connects: no client check, the reviewer connects by hand`. |

A file that breaks a rule fails TT1 with the error message `<name> <place>: <rule>`, the reader's
sentence (the board: `acme-db services.db.source.image: pin the image by digest.`). The marks,
colours and times are `bun test`'s own reporter's (D23).

Once for the folder, `test/templates/index.test.ts` (no board shows it) checks the index: a file
not in the index, a line for a file that is not there, a line that takes another file, lines out of
the order of the names, or anything else in the folder each fail with TI1 to TI5 of
contracts/template-file.md, "The index", so a contributor who forgets the line is told which line to
add. It also holds the index's whole text to the contract's form, so nothing else is in it
(security review T6).

## The check: `.github/workflows/pull-request-checks.yml`

Exactly this file:

```yaml
# Checks every pull request (specs/012-templates/contracts/contributing.md, "The check"): the
# types, the lint rules, every test, and the template tests with Docker. A pull request from a
# fork runs it too.
#
# It runs on `pull_request`, never `pull_request_target`: the pull request's code runs here with a
# token that can only read, and with no secret of the repository. Nothing is published, pushed or
# written outside this machine. The check runs the pull request's own copy of this file and of
# the tests, so a reviewer reads every file a pull request changes (CONTRIBUTING.md, "A pull
# request that changes more").
#
# It reports; on its own it stops nothing. It holds a merge back only where a rule of the
# repository makes `checks` a required check: the maintainer's setting.
name: pull request checks

on:
  pull_request:

# Nothing by default; the one job reads only.
permissions: {}

# A newer push to the same pull request replaces the run for the older one.
concurrency:
  group: pull-request-checks-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    env:
      TURBO_TELEMETRY_DISABLED: "1"
      DO_NOT_TRACK: "1"
    steps:
      # Pinned to the same full commits as the other workflows.
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false

      - name: Read the Bun version
        id: pin
        run: |
          set -euo pipefail
          manager=$(jq -r .packageManager package.json)
          if [[ ! "$manager" =~ ^bun@[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "The root package.json does not pin a Bun version." >&2
            exit 1
          fi
          echo "bun=${manager#bun@}" >> "$GITHUB_OUTPUT"

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: ${{ steps.pin.outputs.bun }}

      # No package's install script runs.
      - name: Install
        run: bun install --frozen-lockfile --ignore-scripts

      - name: Typecheck
        run: bun run typecheck

      - name: Lint
        run: bun run lint

      - name: Test
        run: bun run test

      # Every template file, with Docker, which GitHub's Ubuntu machine has. Each template's image
      # is pulled from Docker Hub by the digest its file names.
      - name: Template tests
        working-directory: apps/cli
        run: bun run test:templates
```

What each property is for:

| Id | Property | Why |
|----|----------|-----|
| CW1 | `on: pull_request` only | A fork's pull request runs with a read-only token and no secret; `pull_request_target` would run it beside the base repository's token (refused by the maintainer). |
| CW2 | `permissions: {}` at the top, `contents: read` on the job | The token can read the code and nothing else. |
| CW3 | `actions/checkout` and `oven-sh/setup-bun` pinned to the full commits `main-versions.yml` uses | A moved tag cannot change what runs. Updating one is a change to all three workflows together. |
| CW4 | `persist-credentials: false` | The token is not left in `.git/config` for the code that runs after. |
| CW5 | No `secrets.` anywhere, no `env` from the event (title, branch, body) | Nothing a pull request writes reaches a shell as code. |
| CW6 | `bun install --frozen-lockfile --ignore-scripts` | The lockfile as committed; no package's install script runs. |
| CW7 | `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run test:templates` in `apps/cli` | The constitution's checks and the template tests (FR-024). `bun run build` is not run: it is `next build` for the site, kept for its own pipeline. |
| CW8 | `timeout-minutes: 30`, `concurrency` per pull request | A run that hangs ends; a newer push replaces an older run. |

A test in `apps/cli/test/templates/workflow.test.ts` reads the file and checks CW1 to CW6 (the
trigger is only `pull_request`, the two permissions, each `uses:` a full 40-hex commit equal to
the one `main-versions.yml` pins, `persist-credentials: false`, no `secrets.` and no
`github.event.` but the pull request's number in `concurrency`, `--frozen-lockfile --ignore-scripts`)
and the four commands of CW7.

## The docs page: `apps/web/content/docs/templates.mdx`

| Id | What |
|----|------|
| TD1 | Title `Templates`, description `Ready-made services you add to an app with zekno add, and how to write one.` |
| TD2 | The `Pre-alpha and unaudited` callout, as `cli.mdx` has it. |
| TD3 | `<TemplateList />`: a table built from `apps/cli/src/templates/files/*.json` at build time (research R14), one row per template in the catalogue's order: `Name` (the name in code, as typed), `What it is` (`<title>`: the about), `Version` (the software's), `Author` (`by <author>`). |
| TD4 | What adding one does, in a few sentences: the service added to `zekno.app.json`, its passwords made on your machine and stored sealed, never shown; a connection secret for your services; nothing deployed until you deploy. And what it does not do (FR-016): Zekno does not back up the data; the data is kept in a Docker volume on your server; the image is pinned by digest, and a newer one comes only with a newer zekno; removing the service from the settings keeps its volume. |
| TD5 | How to add one: the board's five steps (CG5) and a link to the guide, `https://github.com/zekno-app/zekno/blob/main/CONTRIBUTING.md`. |
| TD6 | A test, `apps/web/modules/docs/lib/templates.test.ts`, reads the folder with the page's own function and checks it lists every file, each with its author. |

The component is a Server Component (`apps/web/modules/docs/components/templates.tsx`), registered
in `getMDXComponents`; the reading is a plain function in `apps/web/modules/docs/lib/templates.ts`
that reads only the fields the page shows, with a zod object, and never puts file text into HTML
but as React text.

## What the maintainer does (settings of the repository)

None of these is a file this feature writes. `CONTRIBUTING.md` and the docs say they are the
maintainer's.

| Id | Step |
|----|------|
| MS1 | Make `checks` (workflow `pull request checks`) a required status check for `main` and `dev`, in the branch rules. Until then the check reports and holds nothing back. |
| MS2 | Keep GitHub's "require approval for first-time contributors" (Actions, fork pull request workflows) on, so a stranger's first pull request runs only once a maintainer has looked at it. |
| MS3 | Recommended: a `CODEOWNERS` rule that names the maintainer for `.github/` and `apps/cli/src/templates/publishers.ts`, with "require review from code owners". Not planned as a file here: it is a rule of the repository's review, the maintainer's to set. |
| MS4 | Watch Docker Hub's pull limits: each run pulls the templates' images. If they bite, the maintainer decides (a mirror would be a new service). |
