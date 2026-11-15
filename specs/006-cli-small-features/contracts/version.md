# Version Contract: `zekno --version`, `zekno version`, and the newer release

FR-031 to FR-036, SC-008. Mock-up 6 in [design.md](../design.md) is binding. The check for a newer
release is `checkNewest` in `apps/cli/src/version/newest.ts` (research R14). Where it asks and what
it reads changed on 2026-11-15 ([specs/008-cli-decisions](../../008-cli-decisions/spec.md),
decision 1): it reads the runner release file on `main` from GitHub's raw file host, no longer the
REST API.

## `zekno --version`

At a terminal and in plain output alike, on standard output, at the left edge (`ui.line`, so Ink
does not indent it):

```text
$ zekno --version
zekno 0.1.0
runner 0.1.0, the runner release this zekno installs
```

- Line 1: `zekno <CLI_VERSION>`.
- Line 2: `runner <RUNNER_RELEASE.version>, the runner release this zekno installs`. At a terminal the
  versions are in the text colour and the rest is dim from the comma on, the comma included, as the
  board "The version, and a newer release" draws it. Plain output is the same words.

With `--json`, one object on one line and nothing else: `{"zekno":"0.1.0","runner":"0.1.0"}`.

It **never uses the network** (FR-036): `checkNewest` is not called. Exit status 0. It works with
no profile, no keychain entry and no terminal: it reads nothing but the two versions built into
the program, opens no file, starts no process.

## `zekno version`

The same two lines, then one check for a newer release, then one of three lines (mock-up 6):

```text
$ zekno version
zekno 0.1.0
runner 0.1.0, the runner release this zekno installs
✔ This is the newest release.
```

| Result | `Ui` call | At a terminal | Plain output |
|--------|-----------|---------------|--------------|
| newest | `success(V1)` | `✔ This is the newest release.` | `This is the newest release.` on standard output |
| newer | `warn(V2)` | `! A newer release exists: 0.2.0. Update zekno to get it.` | the sentence on standard error, as every warning |
| not checked | `note(V3)` | `  Could not check for a newer release.` (dim, two spaces in) | `Could not check for a newer release.` on standard output |

Nothing is drawn while it waits (at most 3 seconds). The exit status is 0 in all three cases.
With no terminal the check still runs (FR-036): it was asked for.

With `--json`, one object on one line, the result in `latest`:

```json
{"zekno":"0.1.0","runner":"0.1.0","latest":{"state":"newest"}}
{"zekno":"0.1.0","runner":"0.1.0","latest":{"state":"newer","version":"0.2.0"}}
{"zekno":"0.1.0","runner":"0.1.0","latest":{"state":"not_checked"}}
```

## How it is reached in `run`

- `--help` (or `-h`, or `help`) wins, as today: `zekno --version --help` prints the help.
- The command `version` prints the two lines and checks. `--version` without the command `version`
  (`zekno --version`, `zekno status --version`) prints the two lines and does nothing else, as
  `--help` does with a command; no check. `zekno version extra` is wrong usage
  (``Unexpected "extra" after `zekno version`.``, status 2), as for every command.
- This comes before anything that opens the team, so the keychain is never read.

## The check

`checkNewest(deps, carried, options?: { limitMs?: number }): Promise<Latest>`, `Latest` one of
`{ state: "newest" }`, `{ state: "newer"; version: string }`, `{ state: "not_checked" }`.

| Part | Rule |
|------|------|
| Who calls it | `zekno version` and `zekno doctor` only, each once per run. Nothing checks in the background: no cache file, no timer |
| No fetch | when `deps.fetch` is not set: `not_checked`, nothing requested. `main.ts` sets it to Bun's `fetch`; tests set a stand-in or nothing |
| Request | `GET https://raw.githubusercontent.com/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json`, a fixed string (`RELEASE_FILE`; the branch named by its full ref, so a tag named `main` cannot stand in for it); one header, exactly `User-Agent: zekno`; no `Authorization`, no cookie, no query, no body; `redirect: "manual"` |
| Redirects | a 301, 302, 307 or 308 whose `Location` is an `https:` URL on the host `raw.githubusercontent.com`, with no port and no user name or password, is followed with the same header, at most three times; any other redirect: `not_checked` |
| Time | one `AbortSignal.timeout(limitMs ?? 3000)` for the whole: connecting, redirects, reading the body |
| Status | only 200; anything else (403, 404, 410, 429, 5xx): `not_checked` |
| Body | read from its stream up to 16,384 bytes (16 KiB; the file is under 300); past that the reading is cancelled: `not_checked`; decoded as UTF-8 (`fatal: true`), then `JSON.parse` inside `try` |
| Form | the release file's form, held by the CLI's own strict reader of that file (`RunnerReleaseSchema` in `version/runner-release.ts`, with `safeParse`): `{ "version": "<version>", "files": { "linux-x64": { "sha256": <checksum> }, "linux-arm64": { "sha256": <checksum> } } }`, no other field at any level, `<version>` matching `RUNNER_VERSION_PATTERN`, each `<checksum>` 64 lowercase hex characters or `null`. Anything else: `not_checked` |
| Version | not a development version (`isDevVersion`; on `main` the file never names one, the `check-main` workflow holds that): a development version is `not_checked`. Only the version is kept; the checksums are only looked at |
| Result | `compareRunnerVersions(file, carried) > 0` and both checksums present: `newer` with the file's version. Higher without both checksums (a release started whose second build has not run, so it cannot be installed yet): `newest`, not announced. The same or a lower version: `newest` |
| Anything else | any thrown error, any refusal of the rules above: `not_checked`. Never an exception out of `checkNewest` |

`carried` is the runner release this zekno carries, `(deps.release ?? RUNNER_RELEASE).version`; a
zekno that carries `0.1.0-dev.1` is told that `0.1.0` exists, once the file holds both its
checksums. The answer's version is never placed anywhere but V2 and the `latest` field, and after
the grammar it is digits and dots only. zekno never downloads, installs or runs anything because
of it (FR-035).

What a person sees, by what the file on `main` names (decision 1 of specs/008-cli-decisions):

| The file names | `zekno version` says | `latest` |
|----------------|----------------------|----------|
| a higher version with both checksums | V2, `A newer release exists: <version>. Update zekno to get it.` | `newer` |
| a higher version without both checksums | V1, `This is the newest release.` | `newest` |
| the carried version, or a lower one | V1, `This is the newest release.` | `newest` |
| anything that is not the file's form, or no answer | V3, `Could not check for a newer release.` | `not_checked` |

Known and accepted: the address names a path in the repository. If that file moves again, older
builds say "Could not check for a newer release."; they never say something false.

## In `zekno doctor`

Its first check line (`zekno`) makes the same check, once, beside the other checks. A newer release
makes that line a warning with V2 as its next step (mock-up 6):

```text
! zekno          0.1.0, installs runner 0.1.0
                 A newer release exists: 0.2.0. Update zekno to get it.
```

"Newest" and "not checked" leave the line as it would be without the check (good, or the D2
warning of contracts/doctor.md); no answer is not a warning. `doctor --json` carries `latest` as
above (contracts/doctor.md).

## Sentences

| Id | Sentence | Status |
|----|----------|--------|
| V1 | `This is the newest release.` | mock-up |
| V2 | `A newer release exists: <version>. Update zekno to get it.` | mock-up |
| V3 | `Could not check for a newer release.` | mock-up |

## Where the versions come from

| Version | Source | In the compiled program |
|---------|--------|-------------------------|
| `CLI_VERSION` | `apps/cli/package.json` `version` (set to `0.1.0` in this feature; it was `0.0.0`), imported by `apps/cli/src/version/version.ts` and held to `RUNNER_VERSION_PATTERN` | bundled by `Bun.build`; no `package.json` is read at run time (`autoloadPackageJson: false` in `build.ts`) |
| `RUNNER_RELEASE.version` | `apps/cli/src/version/runner-release.json`, as today (`runner-release.ts`) | bundled, as today |
| the newest release | the release file on `main`, read by the request above, for one line only | asked at run time by `zekno version` and `zekno doctor` |

## Tests

- `apps/cli/test/version/version.test.ts`: `CLI_VERSION` equals `apps/cli/package.json`'s version and fits
  the version grammar; `zekno --version` (with and without `--json`) prints the two lines or the
  object above, returns 0, and never calls `deps.fetch` (a stand-in that fails the test when
  called); `zekno version` with a stand-in fetch answering a newer, the same, an older version and
  nothing prints the two lines and V1, V2 or V3 (plain: V2 on standard error), returns 0, and with
  `--json` the three objects above; with no profile and a key store that throws on any read;
  `zekno version extra` returns 2; through `inkUi` the lines of mock-up 6, the two versions at
  column 0; every other command of `HELP` (but `doctor`) run against a ready machine never calls
  `deps.fetch`; `main.ts` hands `fetch` to `run`.
- `apps/cli/test/version/newest.test.ts`: every row of "The check" with a stand-in fetch, no network:
  a higher version with both checksums, with one, with none; the same and a lower version; a
  development version; extra fields, wrong types, a version outside the grammar, checksums that
  are not 64 lowercase hex characters; a body over the limit; a redirect to another host, to
  http, with a port, with a user name; a hang; status 404 and the others; text that is not JSON.
- `apps/cli/test/compiled.test.ts`: the compiled program and the program run from source, each
  started in a folder holding only a `package.json` with `"version": "9.9.9"`, print the same two
  lines for `--version`, naming `apps/cli/package.json`'s version and `runner-release.json`'s; and
  the compiled program in that file's hostile folder (its `.env` and `bunfig.toml`) prints them
  too, with the folder's preload never run. `--version` needs no network, so these run offline.
- SC-008 for a server's runner: `zekno status` and `zekno doctor` against a stand-in runner that
  reports a version both name that version (feature 005's `reportingRunner`).
