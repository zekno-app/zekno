# Research: The Zekno Terminal App

Checked on 2026-11-13 on macOS with Bun 1.4.2, Ink 8.0.0, React 19.3.1, Docker 29.6.1 and
Compose v5.3.0. Decisions marked **(maintainer)** were made by the maintainer that day; the rest
follow from them or from what the installed tools provide.

## R1. Full-screen rendering

- **Decision**: Ink's own `alternateScreen` render option, with `useWindowSize` for the layout.
- **Rationale**: both ship in the installed Ink 8. The alternate screen restores the person's
  terminal content when the app closes (FR-006). No extra package.
- **Alternatives considered**: a full-screen helper package (a dependency for something Ink
  already does); drawing in the normal screen (leaves the app's frames in the scrollback).

## R2. Components **(maintainer)**

- **Decision**: the select list, text question, confirm, panel with a title, stage row and key
  hints are written in `apps/cli/src/ui/`. No component library.
- **Rationale**: the maintainer chose this over `@inkjs/ui`, whose last release is from May 2024
  and is untested against Ink 8. It keeps a security tool's dependency list short.
- **Note**: Ink's `Box` has no title on a border. The panel draws its top line itself.

## R3. One program, two presentations

- **Decision**: what a command does moves out of `apps/cli/src/commands/` into operations
  (`apps/cli/src/ops/`) that take callbacks for progress and return results. Single commands are
  an operation plus the existing `Ui`. The app is the same operations plus screens.
- **Rationale**: feature 003 already separated printing from logic with `Ui`, but the logic still
  calls `ui.*` as it goes. The app needs the same steps with different drawing, and the desktop
  app will need them again. Operations are also what tests call.
- **Alternatives considered**: the app shelling out to `zekno <command> --json` (loses progress,
  starts a process per action); a second copy of the logic for the app (two things to review).

## R4. One connection: runner session mode **(maintainer)**

- **Decision**: a new runner command, `zekno-runner session`. It reads requests, one JSON line
  each, and writes frames, one JSON line each, until its input closes. A request is answered by
  zero or more event frames and exactly one result frame. Requests are handled one at a time.
- **Rationale**: chosen by the maintainer over OpenSSH connection sharing. It works with any SSH
  client and leaves no socket file. Measured on the maintainer's server, one SSH connection costs
  about 2.4 seconds, and a deploy in feature 003 opens two.
- **Streams**: a `logs` request never produces a result until the reader closes the session. The
  app therefore keeps one session per server for requests and opens a second one while a logs
  screen is showing. A single command uses exactly one (FR-034).
- **Older runners**: a runner from feature 003 has no `session` command and exits with status 2.
  The CLI then falls back to the one-shot commands for deploys, and marks state, logs and
  one-connection behaviour as needing a runner update (FR-012).
- **Alternatives considered**: request ids with several requests in flight on one session (more
  protocol and more to get wrong, for no need this feature has).

## R5. Deploy progress

- **Decision**: in a session, `apply` sends `progress` events carrying Docker's output line by
  line, then its result. The runner no longer writes Docker's output to standard error in
  session mode. The CLI keeps the lines in memory, shows the last one as the live line, and
  shows all of them on request or on failure (FR-015, FR-016).
- **Limits**: a line is cut at 4 KiB and the CLI keeps the last 500 lines.
- **Security note**: Docker's messages can repeat a value filled in from a secret (recorded as a
  limit in feature 003's review). That is unchanged: the same text reached the same terminal
  before, through SSH's standard error. It is still never written to disk.

## R6. What is running

- **Decision**: the runner runs `docker compose -p zekno-<app> ps --all --format json` for each
  app it has accepted a deploy for, and reports per service only: service name, state, exit code
  and health.
- **Checked**: the command prints one JSON object per line with `Service`, `State`
  (`running`, `exited`, ...), `ExitCode`, `Health`, and a large `Labels` string that includes
  host paths. A project that does not exist prints nothing and exits 0.
- **Rationale**: `Labels`, `Command` and the rest are dropped on the server. An app is "running"
  when every service is running, "stopped" when none is, "partly running" otherwise.

## R7. Logs

- **Decision**: `docker compose -p zekno-<app> logs --follow --timestamps --no-color --tail 200`,
  each line parsed into service, time and text on the runner and sent as an event.
- **Checked**: lines look like `web-1     | 2026-11-13T16:56:04.136118801Z started`.
- **Rationale**: the runner stays read-only here (FR-037). The CLI filters and pauses in memory
  and writes nothing to disk (FR-021).

## R8. Text from a server

- **Decision**: one function in the CLI removes terminal control characters and escape sequences
  from every string that comes from a server before it is drawn: log text, progress lines,
  service names (FR-022). Message schemas already restrict app and secret names.
- **Rationale**: feature 003's review found names from the runner reaching the terminal
  unfiltered. Logs and Docker output are far larger sources of the same problem.

## R9. Installing the runner **(maintainer)**

- **Decision**: runner releases are GitHub Releases on the public repository, built by a GitHub
  Actions workflow when a `runner-v*` tag is pushed, for Linux x64 and ARM64. The CLI carries the
  version and the SHA-256 of each file it expects, in `apps/cli/src/runner-release.json`,
  updated in the repository after a release. "Add a server" sends a fixed shell script over SSH;
  the script downloads the file on the server, checks the SHA-256, and only then installs it.
- **Rationale**: chosen by the maintainer: GitHub Releases over a registry or an own domain,
  pinned checksums over a release signing key, GitHub Actions over a local script. The checksum
  comes from the CLI, never from the download (FR-011).
- **Where it installs**: as root, `/usr/local/bin/zekno-runner` with its folder at
  `/var/lib/zekno`. As another user, `~/.local/bin/zekno-runner` with its folder at
  `~/.local/state/zekno`, because that user cannot write the system paths. The runner's default
  folder is: `ZEKNO_RUNNER_HOME` if set. Otherwise root always uses `/var/lib/zekno`. Any other user uses `~/.local/state/zekno` if a runner is already set up there, else `/var/lib/zekno` only if that folder exists and belongs to them, else `~/.local/state/zekno`.
  Servers set up in feature 003 keep working. (The ownership condition was added after the
  security review, finding S5.)
- **What the script needs on the server**: `uname`, `curl` or `wget`, `gzip`, `sha256sum` or
  `shasum`. Files are published gzip-compressed (35 MB against 78 MB) because `gzip` is always
  there.
- **Script safety**: the script text is fixed in the CLI. The only values put into it are the
  version (digits and dots), the architecture (one of two words) and the SHA-256 (64 hex
  characters), each checked against a pattern first. Nothing from the server is put into it.
- **Before a release exists**: `runner-release.json` holds no checksum, and "add a server" says
  there is no published runner to install. For development, `--runner-file <path>` sends a
  locally built runner over SSH and checks its SHA-256 on arrival against the one computed
  locally. This option is for development and is documented as such.
- **Open point**: whether `bun build --compile` output is reproducible was not checked, so a
  third party may not be able to rebuild a release and get the same checksum.

## R10. Questions from SSH inside a full-screen app

- **Decision**: the app first connects with SSH's batch mode, which never asks anything. If that
  fails because SSH needs a password or a host-key answer, the app hands the terminal over with
  Ink's `suspendTerminal`, runs the connection so SSH can ask, and takes the terminal back when
  the runner's first frame arrives.
- **Rationale**: SSH reads its answers from the terminal directly. An app that keeps reading the
  keyboard at the same time would swallow them. With key-based login the hand-over never happens.

## R11. The project file **(maintainer)**

- **Decision**: `zekno.json`, validated strictly: `{ "app", "server", "compose" }`. It is looked
  for in the current folder, then each parent, stopping at the home folder or the filesystem
  root. `compose` is relative to the file and must stay inside its folder.
- **Rationale**: the name and format were chosen by the maintainer. Searching upward lets
  commands work from a sub-folder, as people expect from similar tools.

## R12. Values a Compose file expects

- **Decision**: read the Compose file with Bun's built-in `Bun.YAML.parse`. A name is expected
  when a service's `environment` lists it with no value, or when the file uses `${NAME}` or
  `$NAME` without a default. Names with a default (`${NAME:-x}`) and reserved names are left out.
- **Checked**: `Bun.YAML.parse` exists in Bun 1.4.2 and returns `environment` as written, list or
  map.
- **Rationale**: no YAML dependency. The check is a warning that can be skipped (FR-024), so a
  form it does not understand costs nothing.
- **Alternatives considered**: asking Docker on the server (`docker compose config`), which is
  exact but needs a round trip and would send the file before it is signed.

## R13. Colours and the logo

- **Decision**: the app uses the terminal's own text colour for normal text, its dim variant for
  secondary text, the standard green, red and yellow for state, and the brand blue `#2383e2` for
  focus and for ".app" in the logo. The logo is drawn with half-block characters from a 5-row
  bitmap: 41 columns wide, 3 lines tall.
- **Rationale**: the canvas is drawn on a dark ground, where the terminal's text colour is
  white. Using the terminal's colour, not literal white, keeps the app readable for someone with
  a light terminal. Where a terminal has no 24-bit colour, Ink falls back to the nearest colour.
- **Needs the maintainer's eye**: on a light terminal "zekno" in the logo is dark, not white.

## R14. Testing

- **Decision**: `bun test`. The app's state is a pure reducer with unit tests. Screens are
  rendered to text with Ink's `renderToString` at 100 and 80 columns and compared with the
  wording on the canvas. Operations are tested as in feature 003, against a real runner process
  and a stand-in Docker. Real terminal behaviour (keys, alternate screen, the hidden prompt, the
  SSH hand-over) is checked in a pseudo-terminal that reads continuously, the method that found
  two defects in feature 003.
- **Rationale**: no new test library. `renderToString` does not run key handlers, which is why
  key handling lives in the reducer and is tested there.

## R15. Light and dark terminals **(maintainer, 2026-11-14)**

- **Decision**: the app asks the terminal for its background colour once at start (the OSC 11
  query), with a short timeout. A dark background, or no answer, uses `brand` (`#2383e2`); a
  light one uses a new `brand-darker` token (`#1a73d1`). A selected row is marked by the arrow
  and bold text, never by a background colour.
- **Measured**: `brand` is 5.0:1 on the canvas's dark ground and 3.9:1 on white; `brand-darker`
  is 4.75:1 on white and 3.5 to 4.1:1 on dark grounds. No single blue passes 4.5:1 on both.
- **Rationale**: the maintainer asked for the token and chose detection over one colour
  everywhere. A wrong guess costs a few slightly faint letters, nothing more.

## R16. One kept session per server for the app's reads (2026-11-14)

- **Decision**: the session the app opens to each server when it starts (R10: batch mode
  first, SSH may then ask) is kept open while the app runs, and every read of what is running
  sends `status` and `state` over it. A read with no answer within 20 seconds closes it; a
  lost session is opened again in the background in batch mode only, at most once every 30
  seconds per server, and never where SSH would have to ask. Deploys, rollbacks, secrets and
  logs keep their own connections.
- **Rationale**: until then each read opened a new SSH connection, every 5 seconds per
  server: about 720 logins an hour in the server's auth log; firewall rate limits such as
  `ufw limit` (6 new connections per 30 seconds) can shut the developer out; an SSH agent that
  confirms each use, or a hardware key that needs a touch, asks every 5 seconds although batch
  mode stops SSH's own prompts; and a server that needs a password had no state at all, since
  the background never asks. With one session, a server that needed a password at start is
  read like any other. The runner's session mode already serves any number of requests on one
  connection, with no idle limit; its limits concern lines that are not requests (three in a
  row) and requests sent ahead of their answers (1,024 lines or 32 MiB), neither of which a
  request pair every 5 seconds comes near.
- **Alternatives considered**: OpenSSH connection sharing (`ControlMaster`), rejected in R4;
  reading less often (fewer logins, the same problems, and staler state); taking over the
  session a deploy or logs opens (a long deploy would hold up the reads, and those operations
  are tested to use exactly one connection).

## Design approvals

All seven boards of the canvas's fourth row were approved by the maintainer on 2026-11-14: the
help screen, Home and one app at 80 columns, the "terminal too small" message, Home on a light
terminal, the two questions, and the profile error screen.
