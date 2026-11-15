# Doctor Contract: `zekno doctor`

User Story 4 (FR-022 to FR-026, FR-032). Mock-up 5 in [design.md](../design.md) is binding. The
checks are in `apps/cli/src/ops/doctor.ts` (`runDoctor`, which returns a `DoctorReport` and draws
nothing), the server script in `apps/cli/src/server/check-script.ts`, the command in
`apps/cli/src/commands/doctor.ts`. Research R11 and R12 say why each only reads.

## Usage

```text
zekno doctor [--server <name>] [--json]
```

It never asks anything, at a terminal or not. `--server <name>` checks this machine and that one
server. `--json` prints one JSON object. Exit status 0 when no check is a problem, 1 otherwise, 2
for wrong usage.

`--server <name>` naming no connected server, once the profile verified: nothing is printed but
`findServer`'s sentence, ``No server named "<name>". Connected servers: <names>.``, through the
error line, status 1 (with `--json` too: no object). When the profile does not verify, the name
cannot be looked up: the machine section is shown, with D31 in place of the servers, status 1.

## At a terminal

```text
$ zekno doctor
  This machine
✔ zekno          0.1.0, installs runner 0.1.0
✔ Key            in your system keychain
✔ Profile        verified, team list v2
✔ This folder    linked to demo on prod, compose.yaml is readable

  prod  deploy@203.0.113.7
✔ Reachable      over SSH
✔ Docker         Compose 5.6.0
! Runner         0.1.0-dev.1, older than this zekno's 0.1.0
                 Run zekno server update prod
✔ Disk           133 GB free

  staging  deploy@198.51.100.4
✖ Reachable      SSH needs an answer
                 Open zekno and press enter on staging
–  Docker        not checked
–  Runner        not checked
–  Disk          not checked

  1 problem, 1 warning.
```

Drawn by `Ui.doctorReport(report)` once every check is done; while servers are checked, a step
`Checking <name>` (or `Checking <k> servers`) shows the spinner. The text of each line, counted
from column 0, exactly as the mock-up:

- A section heading: two spaces and `This machine`, bold; for a server two spaces, its name in
  bold, two spaces, and where it is (its SSH destination, or `this machine`), dim. The board
  "zekno doctor" decides the look: it draws two spaces between the name and where it is (this page
  and mock-up 5 in design.md had three), and the headings bold. An empty line before each
  server's heading and before the last line.
- Good, warning, problem: the mark (`✔` green, `!` yellow, `✖` red), a space, the label padded to
  15 columns, the detail. So the detail starts at column 17.
- Not checked: `–`, two spaces, the label padded to 14 columns, `not checked`; the `–` and
  `not checked` dim, the label in the text colour, as the board draws them. The detail also
  starts at column 17.
- A next step: 17 spaces and the sentence, dim, on the line under its check.
- The last line: two spaces and D30, bold (board).

When the profile did not verify, no server is contacted and, in place of the server sections, one
dim line: two spaces and D31.

## The checks

In this order. "Reads" is everything a check touches; none writes, creates, moves or starts
anything on this machine or a server (FR-024, SC-005). Besides the servers, `doctor` makes one
request of its own: the newer-release check to GitHub (contracts/version.md), which sends nothing
about the developer and writes nothing.

### This machine

| Check | Reads | Result and detail | Next step |
|-------|-------|-------------------|-----------|
| `zekno` | `CLI_VERSION`, `RUNNER_RELEASE`; the newer-release check (`checkNewest`, contracts/version.md), once per run, at the same time as the other checks | good: D1. Warning when the check says a newer release exists: D1, next step D50 (mock-up 6). Warning when `releaseFiles(RUNNER_RELEASE)` is empty: D1, next step D2. With both, D50 is the next step. "Newest" and "not checked" change nothing: no answer is not a warning | D50; D2 |
| `Key` | profile.json (`profileStore(home).load()`, for `keyName`), the keychain entry (`readIdentity`) | good: `in your system keychain`. Problem: no profile.json, D3; the keychain cannot be read, D5; no entry, D7; an entry in another form, D9. With profile.json not readable or damaged: not checked (the Profile line says why) | D4, D6, D8, D10 |
| `Profile` | `openTeam(deps)`: profile.json, the keychain, the team lists | good: `verified, team list v<version>`. Problem: profile.json not readable or damaged, D11; `openTeam` refused it, D12 | D13 |
| `This folder` (only with a `zekno.json` here or above, or a `compose.yaml` here) | `findProject(cwd)`, `standingOf(link, trust, home)` (reads `links.json`), `readCompose(source)` | good: D14 or D15. Warning: signed by the team, not used here yet, D16. Problem: not signed by the team, D18; names a server not connected, D20; cannot be read, D22; the Compose file cannot be read or is empty, D24. Not checked: a `zekno.json` while the Profile line is not good | D17, D19, D21, D23 (the reader's sentence), D25 (the reader's sentence) |

### Each server (in profile.json's order, or only `--server`)

Two connections, both in SSH's batch mode (`batchOnly(deps.connect, lines)` from
`app/hand-over.ts`), each stopped after `READ_LIMIT_MS` (20 seconds): first `CHECK_SCRIPT` with the
words `check <runner path>`, then a session. At most four servers are checked at the same time; the
report keeps profile.json's order. A server on this machine (`--local`) is reached by its local
runner as every command does; it has no script, so its Docker and Disk lines are not checked.
When its session cannot be opened, its Reachable line is the problem, with D43 (or D27) and D51;
any other failure of its runner is its Runner line's, with D51 (as built; needs approval). A
runner over SSH that does not answer its session within the limit is a Runner problem with D27
and D44. Only the runner of a server over SSH is compared with this zekno; a runner from before
sessions is also asked its one-shot `status`, which only reads.

| Check | Reads | Result and detail | Next step |
|-------|-------|-------------------|-----------|
| `Reachable` | the script's `connected` | good: `over SSH` (on this machine: `on this machine`, from the session). Problem: SSH ended with status 255 before `connected` and `wouldHaveAsked(lines)`: `SSH needs an answer`; status 255 otherwise: D26; nothing within 20 seconds: D27; lines it does not read (anything not in the list below, out of order, too long, or no `done`): D28 | `Open zekno and press enter on <server>` (mock-up); D29 with the destination; D29; D32 |
| `Docker` | the script's `docker ok <v>` / `docker none` | good: `Compose <v>` when `<v>` has a version's shape (`^v?[0-9]+(\.[0-9]+){1,3}$`, the `v` dropped), else `Compose, version not reported`. Problem: `docker none`, `not found with Compose` | D33 |
| `Runner` | the script's `runner here` / `runner none`; the session's version and protocol (`session.runner`, `session.mode`), its `status` and `checkIdentity` | good: `<version>` when the relation is "same"; on this machine `<version>, on this machine` (never compared, as today). Warning: older, D34; does not report its version, D35; newer, same protocol, D36. Problem: newer, higher protocol, D37; `runner none`, D39; answered as another server, D41; any other failure of the session, D43 | `Run zekno server update <server>` (mock-up) for D34 and D35; D36n; D38; D40; D42; D44 |
| `Disk` | the script's `space <KiB>` / `space unknown` | good: `<free> free` at 1,048,576 KiB or more. Warning: below 1,048,576 KiB (1 GiB), `<free> free`; `space unknown`, D45. Problem: below 262,144 KiB (256 MiB, what the installer needs), `<free> free` | D46; D47; D48 |

`<free>`: the KiB times 1024; at 10⁹ bytes or more `<n> GB` (rounded), below that `<n> MB` (rounded,
at least 1). `Runner`'s relation is `runnerRelation(mode, runner, RUNNER_RELEASE.version)` of
feature 005. A check after a `Reachable` that is not good is not checked; `Runner` is not checked
when the session could not be opened for a reason that `Reachable` already reports.

## `CHECK_SCRIPT`

Sent on standard input to `sh -s -- check <runner path>`, the path from profile.json, checked by
`isInstallPath` (`install.ts`) before it is placed. Fixed text: one `{ ... }` block, no `${`, no
backquote, the C locale first, as the installer. It runs nothing that writes.

```sh
{
set -eu
LC_ALL=C
export LC_ALL
say() { printf '%s\n' "$*"; }
fail() { say "fail $1"; exit 1; }
trap 'exit 1' HUP INT TERM

say connected

[ "$#" -eq 2 ] || fail usage
[ "$1" = check ] || fail usage
target=$2
case $target in ''|-*) fail usage ;; esac

if command -v docker >/dev/null 2>&1 && docker compose version </dev/null >/dev/null 2>&1; then
  compose=$(docker compose version --short </dev/null 2>/dev/null | head -n 1 | cut -c 1-32) || compose=
  case $compose in ''|*[!0-9A-Za-z.+-]*) compose=unknown ;; esac
  say "docker ok $compose"
else
  say "docker none"
fi

set +u
home=$HOME
set -u
if [ "$(id -u)" = 0 ]; then
  folder=/var/lib/zekno
else
  case $home in /*) ;; *) fail home ;; esac
  folder=$home/.local/state/zekno
fi

case $target in
  '~/'*) runner=$home/$(printf '%s' "$target" | cut -c 3-) ;;
  */*) runner=$target ;;
  *) runner=$(command -v "$target" 2>/dev/null) || runner= ;;
esac
case $runner in */*) ;; *) runner= ;; esac
if [ -n "$runner" ] && [ -f "$runner" ] && [ -x "$runner" ]; then say "runner here"; else say "runner none"; fi

place=$folder
while [ ! -d "$place" ]; do
  above=$(dirname "$place")
  [ "$above" != "$place" ] || break
  place=$above
done
free=
if command -v df >/dev/null 2>&1; then
  free=$(df -Pk "$place" </dev/null 2>/dev/null | tail -n 1 | tr -s ' ' | cut -d ' ' -f 4) || free=
fi
case $free in ''|*[!0-9]*) say "space unknown" ;; *) say "space $free" ;; esac
say done
exit 0
}
```

The lines it prints, each read against its pattern, in this order (any other line, order, or a line
over 256 bytes ends the reading):

| Line | Pattern |
|------|---------|
| `connected` | `^connected$` |
| `docker ok <v>`, `docker none` | `^docker ok ([0-9A-Za-z.+-]{1,32})$`, `^docker none$` |
| `runner here`, `runner none` | `^runner (here\|none)$` |
| `space <KiB>`, `space unknown` | `^space ([0-9]{1,15}\|unknown)$` |
| `done` | `^done$` |
| `fail usage`, `fail home` (after `connected`) | `^fail (usage\|home)$`; `fail usage` is D28 on `Reachable`; `fail home` makes `Runner` and `Disk` problems with D49 |

What it shares with the installer, copied word for word: the Docker and Compose lines, the
`$HOME` and `id -u` lines, the runner lookup lines of an update, and the `df -Pk ... | cut -d ' '
-f 4` line. A test runs both scripts against the same stand-in server and compares what they find.

## `--json`

One object on standard output; nothing else on standard output; no colour, no symbols:

```json
{
  "zekno": "0.1.0",
  "runner": "0.1.0",
  "machine": [
    { "check": "zekno", "result": "good", "detail": "0.1.0, installs runner 0.1.0" },
    { "check": "key", "result": "good", "detail": "in your system keychain" },
    { "check": "profile", "result": "good", "detail": "verified, team list v2" },
    { "check": "folder", "result": "good", "detail": "linked to demo on prod, compose.yaml is readable" }
  ],
  "servers": [
    {
      "name": "prod",
      "where": "deploy@203.0.113.7",
      "checks": [
        { "check": "reachable", "result": "good", "detail": "over SSH" },
        { "check": "docker", "result": "good", "detail": "Compose 5.6.0" },
        { "check": "runner", "result": "warning", "detail": "0.1.0-dev.1, older than this zekno's 0.1.0", "next": "Run zekno server update prod" },
        { "check": "disk", "result": "good", "detail": "133 GB free" }
      ]
    },
    {
      "name": "staging",
      "where": "deploy@198.51.100.4",
      "checks": [
        { "check": "reachable", "result": "problem", "detail": "SSH needs an answer", "next": "Open zekno and press enter on staging" },
        { "check": "docker", "result": "not_checked" },
        { "check": "runner", "result": "not_checked" },
        { "check": "disk", "result": "not_checked" }
      ]
    }
  ],
  "serversSkipped": false,
  "latest": { "state": "newest" },
  "problems": 1,
  "warnings": 1
}
```

`latest` is the newer-release check's result, as `zekno version --json` gives it:
`{ "state": "newest" }`, `{ "state": "newer", "version": "0.2.0" }` or `{ "state": "not_checked" }`.
`result` is one of `good`, `warning`, `problem`, `not_checked`. `detail` is left out for
`not_checked`; `next` is present exactly for `warning` and `problem`. The `detail` and `next` texts
are the same as at a terminal. It is printed on one line (`ui.json`).

## Plain output (no terminal, no `--json`)

One line per check, cells separated by tabs: where (`this machine` or the server's name), the check
id, the result word (`good`, `warning`, `problem`, `not checked`), then the detail and the next
step when there are any; then the last line. No headings, no empty lines, no symbols.

```text
this machine	zekno	good	0.1.0, installs runner 0.1.0
prod	runner	warning	0.1.0-dev.1, older than this zekno's 0.1.0	Run zekno server update prod
staging	docker	not checked
1 problem, 1 warning.
```

With the servers skipped, the line D31 takes their place.

## Sentences

The details and next steps the mock-up shows are approved; the rest need approval (research Q4).
`<server>` is a name, `<dest>` an SSH destination, `<v>`, `<F>`, `<C>` versions (`<C>` the one this
zekno carries).

| Id | Text |
|----|------|
| D1 | `<CLI_VERSION>, installs runner <C>` (mock-up) |
| D2 | `This build holds no checksum for runner <C>, so it cannot install a runner` |
| D3 | `no team on this machine` |
| D4 | `Run zekno deploy in a project folder, or zekno init` |
| D5 | `the system keychain could not be read` |
| D6 | `Unlock the keychain, or let zekno read it, and run zekno doctor again` |
| D7 | `not in the system keychain` |
| D8 | `Restore the keychain from a backup: the key is kept nowhere else` |
| D9 | `the keychain entry is not in a form this zekno reads` |
| D10 | `Use the zekno that made this key, or a newer one` |
| D11 | `profile.json cannot be read` |
| D12 | `could not be verified` |
| D13 | `Restore <profile folder> from a copy you trust: zekno does not repair it` (`<profile folder>` as `tilde` shows it, for example `~/.zekno`). In `--json` the check also carries `"reason"`: the sentence `openTeam` or `profileStore` gave |
| D14 | `linked to <app> on <server>, <compose> is readable` (mock-up) |
| D15 | `not linked, compose.yaml is readable` |
| D16 | `linked to <app> on <server> by <member>, not used here yet` |
| D17 | `Run zekno link here to use it` |
| D18 | `zekno.json is not signed by your team` |
| D19 | `Run zekno link --app <name> --server <name> --force to link this folder yourself` |
| D20 | `zekno.json names <server>, which is not connected here` |
| D21 | `Connect it, or link this folder again with zekno link --force` |
| D22 | `zekno.json cannot be used` |
| D23 | the sentence `findProject` gave, unchanged |
| D24 | `linked to <app> on <server>, <compose> cannot be read`, or without a zekno.json `compose.yaml cannot be read` |
| D25 | the sentence `readCompose` gave, unchanged |
| D26 | `could not be reached over SSH` |
| D27 | `did not answer within 20 seconds` |
| D28 | `answered, but not as zekno expects` |
| D29 | `Check with: ssh <dest> true` |
| D30 | `<p> problem(s), <w> warning(s).`, each count written `no` when 0 and the first letter in capitals: `1 problem, 1 warning.` (mock-up), `No problems, no warnings.`, `No problems, 2 warnings.` |
| D31 | `No server was checked, because the profile could not be verified.` |
| D32 | `Check that the login shell on <server> prints nothing of its own` |
| D33 | `Install Docker with its Compose plugin on <server>` |
| D34 | `<F>, older than this zekno's <C>` (mock-up) |
| D35 | `does not report its version, older than this zekno's <C>` |
| D36 | `<F>, newer than this zekno's <C>`; next step D36n `Update zekno to match it` |
| D37 | `<F>, newer than this zekno's <C>, and speaks a newer protocol` |
| D38 | `Update zekno before you deploy to <server>` |
| D39 | `not found at <runner path>` |
| D40 | `Put the runner back at that path, as apps/runner/README.md describes` |
| D41 | `answered as a different server than the one connected as <server>` |
| D42 | `Check that <dest> is the server you added as <server>` |
| D43 | the session's sentence, cut at its first full stop and without it, and without a leading `The runner ` (or `The runner on that server `), since the line's label says it (for example `did not answer as expected`) |
| D44 | `Run zekno server update <server> to replace it` |
| D45 | `free space could not be read` |
| D46 | `Free some space on <server> before the next deploy` |
| D47 | `Check with: ssh <dest> df -Pk` |
| D48 | `Free some space on <server>: updating the runner needs 256 MiB` |
| D49 | `the user zekno logs in as has no home folder` (detail of both), next step `Log in as a user with a home folder` |
| D50 | `A newer release exists: <version>. Update zekno to get it.` (mock-up 6, V2 of contracts/version.md) |
| D51 | `Run zekno status --server <server> to see why`: the next step of a problem with a runner on this machine (`--local`), which `zekno server update` cannot replace. Added while building, not in the plan: needs approval |

`SSH needs an answer` and `Open zekno and press enter on <server>`, `over SSH`, `Compose <v>`,
`<free> free` and `not checked` are mock-up words.
