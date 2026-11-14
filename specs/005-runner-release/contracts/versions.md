# Versions Contract: what a person is told

What the CLI and the app say about a runner's version, and the installer's new ways to stop. The
order of versions is in data-model.md. Everything here except W1 changes approved wording and
needs the maintainer's approval first (research, open question Q4). W1 is the rewording the
rename requires (FR-016a).

In the sentences: `<S>` the server's name, `<F>` the version the runner reports, `<C>` the version
this zekno carries (`runner-release.json`).

## The relation

`runnerRelation(mode, runner, carried)` in `apps/cli/src/ops/server.ts` replaces `isOutdated`:

| Runner | Relation | What does not work until it is updated |
|--------|----------|-----------------------------------------|
| does not speak sessions, so reports no version | older | running state and logs |
| reports `<F>` before `<C>`, protocol lower than `RUNNER_PROTOCOL` | older | some of what this zekno does |
| reports `<F>` before `<C>`, same protocol | older | nothing |
| reports exactly `<C>` | same | nothing |
| reports `<F>` after `<C>`, same protocol | newer | nothing |
| reports `<F>` after `<C>`, higher protocol | newer | possibly anything: update zekno before deploying |

A runner on this machine (`--local`) is never compared, as today.

## Single commands

Said once, on standard error (`Ui.warn`), by `zekno status` and by `zekno server add` after the
server is connected. Nothing is said when the relation is "same". `--json` output is unchanged.

| Id | When | Sentence |
|----|------|----------|
| W1 | older, no version | ``The runner on <S> does not report its version, so it is older than this zekno's <C>. Deploys still work. Running state and logs need the newer runner: run `zekno server update <S>`.`` |
| W2 | older, same protocol | ``The runner on <S> is version <F>, older than this zekno's <C>. Everything works with it. To bring it to <C>, run `zekno server update <S>`.`` |
| W3 | older, lower protocol | ``The runner on <S> is version <F>, older than this zekno's <C>. Deploys still work. Some of what this zekno does needs the newer runner: run `zekno server update <S>`.`` |
| W4 | newer, same protocol | ``The runner on <S> is version <F>, newer than this zekno's <C>. It works with this zekno. Update zekno to match it; `zekno server update` never replaces a newer runner.`` |
| W5 | newer, higher protocol | `The runner on <S> is version <F>, newer than this zekno's <C>, and speaks a newer protocol. Update zekno before you deploy to <S>.` |

When exactly one of `<F>` and `<C>` is a dev version, one sentence is added at the end:

| Id | When | Added |
|----|------|-------|
| D1 | `<F>` is dev, `<C>` is not | `Version <F> is a development release.` |
| D2 | `<C>` is dev, `<F>` is not | `This zekno carries a development release.` |

Examples. A zekno built from `main` (`0.1.0`) on a server that runs `0.1.0-dev.1`: W2 then D1. A
zekno built from `dev` (`0.1.0-dev.2`) on a server that runs `0.1.0`: W4 then D2.

`zekno server update` keeps its sentences: the question `Replace the runner on <S> with version
<C>? The server downloads it and checks it before it replaces the old one.`; `Updated the runner on
<S> from <F> to <C>. It matched the checksum this zekno holds.` (without "from <F>" when it reported
none); `The runner on <S> already has version <C>. Nothing was changed.`; and for a newer runner
`The runner on <S> is newer than the <C> this zekno carries, so it was left as it is. Update zekno
instead.`

## The app

| Where | older | same | newer |
|-------|-------|------|-------|
| Home, the line under the server's name (warning colour) | `! older runner` | none (`●` beside the name, as today) | `! newer runner` |
| Home, key hints | `u update runner` | as today | as today |
| `u` on Home | the question below | nothing | nothing |
| A notice, once per server each time the app runs, when it is first read | none (the line and `u` say it) | none | W4 or W5, then D1 or D2 when they apply |
| Add a server, the runner step's detail | `version <F>, out of date`; with no version `no version reported, out of date` | `version <F>` | `version <F>, newer than this zekno` |
| Add a server, the line on Home when it is done | `Connected <S>. Its runner is older than this zekno: deploys work, and u updates it.` (as today) | as today | `Connected <S>. Its runner is newer than this zekno: update zekno to match it.` |

`! older runner` and `! newer runner` are 14 characters and fit the 16 the servers pane leaves at
80 columns. They replace `! runner <F>` and `! old runner`: a dev version beside "runner" does not
fit.

The question (`u`), titled `The runner on <S> is out of date` as today:

- the rows `on <S>` with `<F>` or `no version reported`, and `this zekno` with `<C>`;
- then, by what does not work: `Deploys still work. Running state and logs need the newer runner.`
  (no version); `Deploys still work. Some of what this zekno does needs the newer runner.` (lower
  protocol); `Everything works with it.` (same protocol);
- then, dim, as today: `Updating downloads the runner on <S> and checks it before it replaces the
  old one. Your apps keep running.`

## The installer's new and changed failures

Each comes from one line `fail <word>` (data-model.md, "Installer failures"). In an update, the
last sentence is `The runner that was there is still in place.` instead of `Nothing was installed.`

| Word | Sentence |
|------|----------|
| `tools` (changed) | `The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed.` |
| `libc` | `This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. Nothing was installed.` |
| `cpu` | `This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. Nothing was installed.` |
| `space` | `The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. Nothing was installed.` |

When the new runner wrote something on standard error before it failed, its first line (at most 200
characters) is passed on before the sentence, as any line from the server is: cleaned, and shown as
the server's (`remote:` in single commands, the details in the app).

When the installer decides each:

| Word | Before the download | After the checksum matched, when `version` from the temporary folder fails |
|------|---------------------|-----------------------------------------------------------------------------|
| `tools` | neither `sha256sum` nor `shasum` | |
| `libc` | `getconf GNU_LIBC_VERSION` prints `glibc <x>.<y>` below 2.17, or `ldd --version` names musl | exit status 127, or `GLIBC_` in its standard error |
| `cpu` | | exit status 132 (killed by an illegal instruction) |
| `version` | | anything else (unchanged) |
| `space` | | (not here: when the download or unpacking fails, `df -Pk` of the runner's folder shows under 262144 KiB free) |

A check that cannot be made (no `getconf`, no `ldd`, no `df`, an answer of another shape) does not
stop the install; the checks after the download still apply.
