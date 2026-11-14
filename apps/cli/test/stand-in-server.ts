/**
 * A stand-in server for the runner's installer, on this machine, in a
 * temporary folder: a home folder, the few tools the script uses, and
 * stand-ins for `uname`, `curl`, `wget`, `docker`, `sha256sum` and `id`
 * placed first on PATH, with `df`, `getconf` and `ldd` added when a test
 * gives their answer. It never reaches the network and never runs as root:
 * `id -u` says 1000, and a download is a file the test prepared.
 *
 * With `sshStandIn`, it also has a stand-in for `ssh` that runs the remote
 * command with `sh -c` in that home folder, as a server would, and can fail
 * in batch mode the way SSH does when it would have to ask a question.
 */
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { RUNNER_MAIN, tempDir } from "../../runner/test/helpers"
import { INSTALL_SCRIPT } from "../src/install"

/** The system tools the script and the stand-ins use, linked into a folder of their own so nothing else is on PATH. */
const TOOLS = [
  "cat",
  "chmod",
  "cut",
  "dirname",
  "env",
  "expr",
  "gzip",
  "head",
  "ls",
  "mkdir",
  "mktemp",
  "mv",
  "rm",
  "sed",
  "sh",
  "sleep",
  "tail",
  // Not the script's: the runner's stand-in Docker uses it when a test deploys over the stand-in `ssh`.
  "touch",
  "tr",
  "wc",
]

/** How the real SHA-256 of a file is computed on this machine, for the stand-in `sha256sum`. */
function realSha256(): string {
  const sha256sum = Bun.which("sha256sum", { PATH: "/usr/bin:/bin:/sbin:/usr/sbin" })
  if (sha256sum) return `exec "${sha256sum}" "$@"`
  const shasum = Bun.which("shasum", { PATH: "/usr/bin:/bin" })
  if (!shasum) throw new Error("this machine has neither sha256sum nor shasum")
  return `exec "${shasum}" -a 256 "$@"`
}

const write = (path: string, text: string, mode = 0o755) => {
  writeFileSync(path, text)
  chmodSync(path, mode)
}

/** A stand-in runner: answers `version` with `version`, and in `session` echoes each line it reads after saying `session`. */
export function fakeRunner(version: string | undefined): string {
  const versionLine = version === undefined ? "exit 2" : `printf '%s\\n' '{"version":"${version}","protocol":2}'`
  return `#!/bin/sh
case $1 in
  version) ${versionLine} ;;
  session) echo session; while IFS= read -r line; do printf 'got %s\\n' "$line"; done ;;
  *) exit 2 ;;
esac
`
}

/** The real runner from this repository, with the stand-in Docker of the runner's tests: what a release would be, as a shell script. */
export function realRunner(docker: string): string {
  return `#!/bin/sh\nexec env ZEKNO_DOCKER="${docker}" "${process.execPath}" "${RUNNER_MAIN}" "$@"\n`
}

/**
 * The real runner, as a release of `version` would be: it answers `version`
 * with that version, and does everything else as the runner of this
 * repository does.
 */
export function releasedRunner(docker: string, version: string): string {
  return `#!/bin/sh
if [ "$1" = version ]; then printf '%s\\n' '{"version":"${version}","protocol":2}'; exit 0; fi
exec env ZEKNO_DOCKER="${docker}" "${process.execPath}" "${RUNNER_MAIN}" "$@"
`
}

/** A runner that does not report its version: it knows neither `version` nor `session`, as feature 003's runner. */
export function olderRunner(docker: string): string {
  return `#!/bin/sh
case $1 in
  version|session) echo 'Usage: zekno-runner <setup|sync|apply|status>' >&2; exit 2 ;;
esac
exec env ZEKNO_DOCKER="${docker}" "${process.execPath}" "${RUNNER_MAIN}" "$@"
`
}

export const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

export type ScriptRun = { lines: string[]; stderr: string; code: number }

/**
 * The stand-ins' text. Each finds the server it belongs to from where it was
 * started (`<root>/stand-ins/<name>`), so the same files serve every server:
 * they are written once per test run and hard-linked into each server's
 * folder. A new program is checked by macOS the first time it starts, about
 * a third of a second each; a hard link to one that already ran is not.
 */
const STAND_IN_TEXT: Record<string, string> = {
  uname: `[ "$1" = -sm ] || exit 1\ncat "$state/uname"\n`,
  id: `[ "$1" = -u ] && { echo 1000; exit 0; }\necho 'uid=1000(deploy)'\n`,
  sha256sum: `${realSha256()}\n`,
  docker: `printf '%s\\n' "$*" >> "$state/docker.log"
if [ "$1" = compose ] && [ -f "$state/no-compose" ]; then echo "docker: 'compose' is not a docker command." >&2; exit 1; fi
if [ "$1 $2" = "compose version" ]; then
  if [ "$3" = --short ]; then echo 2.40.3; else echo 'Docker Compose version v2.40.3'; fi
  exit 0
fi
exit 1
`,
  // As curl does: with --proto-redir =https a redirect to http is refused, and without it followed.
  curl: `all=" $* "
printf '%s\\n' "$*" >> "$state/curl.log"
out=
while [ $# -gt 0 ]; do if [ "$1" = -o ]; then out=$2; shift 2; else shift; fi; done
case $(cat "$state/fetch") in
  ok) cat "$state/release.gz" > "$out" ;;
  fail) echo 'curl: (6) Could not resolve host: github.com' >&2; exit 6 ;;
  redirect-http)
    case $all in *" --proto-redir =https "*) echo 'curl: (1) Protocol "http" not supported or disabled in libcurl' >&2; exit 1 ;; esac
    cat "$state/evil.gz" > "$out" ;;
esac
`,
  // As GNU wget does with -S and --max-redirect=0 (checked against wget 1.25): the headers on standard error, status 8 on a redirect.
  wget: `out=
url=
printf '%s\\n' "$*" >> "$state/wget.log"
while [ $# -gt 0 ]; do case $1 in -O) out=$2; shift 2 ;; *) url=$1; shift ;; esac; done
printf '%s\\n' "$url" >> "$state/wget.urls"
mode=$(cat "$state/fetch")
case $url in
  https://github.com/*)
    [ "$mode" = fail ] && { echo "wget: unable to resolve host address 'github.com'" >&2; exit 4; }
    : > "$out"
    if [ "$mode" = redirect-http ]; then next=http://objects.example/zekno-runner.gz; else next=https://objects.example/zekno-runner.gz; fi
    printf '  HTTP/1.1 302 Found\\r\\n  Location: %s\\r\\n  Content-Length: 0\\r\\n' "$next" >&2
    exit 8 ;;
  https://objects.example/*) cat "$state/release.gz" > "$out"; printf '  HTTP/1.1 200 OK\\n' >&2; exit 0 ;;
  http://*) cat "$state/evil.gz" > "$out"; exit 0 ;;
esac
exit 8
`,
  // As \`df -Pk <folder>\` does: a header, then one line whose fourth field is the KiB available there.
  df: `printf '%s\\n' "$*" >> "$state/df.log"
[ "$1" = -Pk ] || exit 1
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '/dev/vda1 41152736 30000000 %s 75%% /\\n' "$(cat "$state/df")"
`,
  // As \`getconf GNU_LIBC_VERSION\` does on a glibc system: \`glibc 2.36\`.
  getconf: `[ "$1" = GNU_LIBC_VERSION ] || exit 1
cat "$state/getconf"
`,
  // As \`ldd --version\` does: glibc's on standard output, musl's on standard error with status 1.
  ldd: `[ "$1" = --version ] || exit 1
if [ -f "$state/ldd.err" ]; then cat "$state/ldd.err" >&2; exit 1; fi
cat "$state/ldd.out"
`,
}

let sharedStandIns: string | undefined

/** The stand-ins, written once for this test run: `name`'s file, to be linked into a server. */
function standInFile(name: string): string {
  if (!sharedStandIns) {
    sharedStandIns = tempDir("stand-ins")
    for (const [tool, text] of Object.entries(STAND_IN_TEXT)) {
      write(join(sharedStandIns, tool), `#!/bin/sh\nstate=$(dirname "$0")/../state\n${text}`)
    }
  }
  return join(sharedStandIns, name)
}

/** Puts the stand-in `name` first on the server's PATH. */
function placeStandIn(standIns: string, name: string) {
  const to = join(standIns, name)
  rmSync(to, { force: true })
  try {
    linkSync(standInFile(name), to)
  } catch {
    // Another file system: a copy works the same, only its first start is slower.
    copyFileSync(standInFile(name), to)
    chmodSync(to, 0o755)
  }
}

export function standInServer() {
  const root = tempDir("server")
  const home = join(root, "home")
  const standIns = join(root, "stand-ins")
  const tools = join(root, "tools")
  const state = join(root, "state")
  const tmp = join(root, "tmp")
  for (const dir of [home, standIns, tools, state, tmp]) mkdirSync(dir, { recursive: true })
  for (const tool of TOOLS) {
    const real = Bun.which(tool, { PATH: "/bin:/usr/bin" })
    if (!real) throw new Error(`this machine has no ${tool}`)
    symlinkSync(real, join(tools, tool))
  }
  const at = (name: string) => join(state, name)

  // `df`, `getconf` and `ldd` are off: a server without them, until a test gives an answer.
  for (const name of ["uname", "id", "sha256sum", "docker", "curl", "wget"]) placeStandIn(standIns, name)
  write(at("uname"), "Linux x86_64\n", 0o644)
  write(at("fetch"), "ok\n", 0o644)
  writeFileSync(at("evil.gz"), Bun.gzipSync(new TextEncoder().encode(fakeRunner("6.6.6"))))

  const env = (): Record<string, string> => ({ HOME: home, PATH: `${standIns}:${tools}`, TMPDIR: tmp, LC_ALL: "C" })
  const lines = (file: string) => (existsSync(at(file)) ? readFileSync(at(file), "utf8").trim().split("\n").filter(Boolean) : [])

  const server = {
    root,
    home,
    standIns,
    tmp,
    env,
    /** Where the installer puts the runner for this (non-root) user, and its folder. */
    runnerPath: join(home, ".local", "bin", "zekno-runner"),
    folder: join(home, ".local", "state", "zekno"),
    /** The file a download yields, gzip-compressed; returns the SHA-256 of what it unpacks to. */
    release(content: string): string {
      writeFileSync(at("release.gz"), Bun.gzipSync(new TextEncoder().encode(content)))
      return sha256(content)
    },
    /** The file a download yields, as it is: for a `.gz` the test made itself. */
    releaseGz(bytes: Uint8Array) {
      writeFileSync(at("release.gz"), bytes)
    },
    /** `df -Pk` answers with this many KiB available. */
    df(kib: number | string) {
      writeFileSync(at("df"), `${kib}`)
      placeStandIn(standIns, "df")
    },
    /** `getconf GNU_LIBC_VERSION` prints this line. */
    getconf(line: string) {
      writeFileSync(at("getconf"), `${line}\n`)
      placeStandIn(standIns, "getconf")
    },
    /** `ldd --version` prints this: on standard error with status 1, as musl's does, or on standard output, as glibc's does. */
    ldd(text: string, stream: "stderr" | "stdout" = "stderr") {
      rmSync(at("ldd.err"), { force: true })
      writeFileSync(at(stream === "stderr" ? "ldd.err" : "ldd.out"), `${text}\n`)
      placeStandIn(standIns, "ldd")
    },
    /** `ok`, `fail` or `redirect-http`. */
    fetch(mode: "ok" | "fail" | "redirect-http") {
      writeFileSync(at("fetch"), `${mode}\n`)
    },
    uname(value: string) {
      writeFileSync(at("uname"), `${value}\n`)
    },
    noCompose() {
      writeFileSync(at("no-compose"), "")
    },
    remove(tool: string) {
      rmSync(join(standIns, tool), { force: true })
    },
    /** Puts a runner where the installer would, as an earlier install or a person would have. */
    installed(content: string) {
      mkdirSync(join(home, ".local", "bin"), { recursive: true })
      write(server.runnerPath, content)
    },
    /** Each call of a stand-in, its arguments on one line. */
    calls: (tool: "curl" | "wget" | "docker" | "df") => lines(`${tool}.log`),
    wgetUrls: () => lines("wget.urls"),
    /** Anything the installer left behind: its temporary folders, and anything in TMPDIR. */
    leftovers(): string[] {
      const bin = join(home, ".local", "bin")
      const inBin = existsSync(bin) ? readdirSync(bin).filter((name) => name.startsWith(".zekno-install.")) : []
      return [...inBin, ...readdirSync(tmp)]
    },
    mode: (path: string) => statSync(path).mode & 0o777,
    /**
     * Runs the installer script as the CLI would, with `sh -s -- <words>`
     * and the script on standard input. After `ready` it sends `file`; after
     * `done` it sends `afterDone`; then it closes the script's input. An
     * update's input is closed right after the script, as the CLI does.
     * `env` adds to or replaces the server's variables, such as a locale
     * SSH passed on.
     */
    async run(words: readonly string[], options: { shell?: string; file?: Uint8Array; afterDone?: string; env?: Record<string, string> } = {}): Promise<ScriptRun> {
      const child = Bun.spawn([options.shell ?? "/bin/sh", "-s", "--", ...words], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env(), ...options.env },
        cwd: home,
      })
      child.stdin.write(INSTALL_SCRIPT)
      await child.stdin.flush()
      if (words[0] === "update") await child.stdin.end()
      const stderr = new Response(child.stderr).text()
      const out: string[] = []
      const decoder = new TextDecoder()
      let rest = ""
      let closed = words[0] === "update"
      const close = async () => {
        if (closed) return
        closed = true
        await child.stdin.end()
      }
      for await (const chunk of child.stdout) {
        const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n")
        rest = parts.pop() ?? ""
        for (const line of parts) {
          out.push(line)
          if (line === "ready" && options.file && !closed) {
            child.stdin.write(options.file)
            await child.stdin.flush()
            await close()
          } else if (line.startsWith("done ") && options.afterDone !== undefined && !closed) {
            child.stdin.write(options.afterDone)
            await child.stdin.flush()
            await close()
          } else if (line.startsWith("done ") || line.startsWith("fail ")) {
            await close()
          }
        }
      }
      if (rest) out.push(rest)
      await close()
      return { lines: out, stderr: await stderr, code: await child.exited }
    },
  }
  return server
}

export type StandInServer = ReturnType<typeof standInServer>

/**
 * A stand-in for `ssh` in front of `server`: it notes how it was called,
 * finds the destination after `--`, and runs the remote command with `sh -c`
 * in the server's home, with the server's environment, as sshd would. With
 * `ask()`, a call in batch mode fails as SSH does where it would have asked
 * for a password; without batch mode it goes ahead (and, on a terminal,
 * asks first: see `askOnTerminal`).
 */
export function sshStandIn(server: StandInServer) {
  const dir = tempDir("ssh")
  const log = join(dir, "ssh.log")
  const asks = join(dir, "ask")
  const tty = join(dir, "tty")
  const unanswered = join(dir, "unanswered")
  const down = join(dir, "down")
  const path = join(dir, "ssh")
  const env = server.env()
  write(
    path,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
batch=
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
  if [ "$1" = -o ] && [ "$2" = BatchMode=yes ]; then batch=1; fi
  shift
done
[ "$1" = -- ] || exit 255
dest=$2
command=$3
if [ -f "${down}" ]; then echo "ssh: connect to host $dest port 22: Connection refused" >&2; exit 255; fi
if [ -f "${asks}" ]; then
  if [ -n "$batch" ]; then echo "$dest: Permission denied (publickey,password)." >&2; exit 255; fi
  if [ -f "${unanswered}" ]; then echo "$dest: Permission denied (publickey,password)." >&2; exit 255; fi
  if [ -f "${tty}" ]; then
    printf '%s' "$dest's password: " > /dev/tty
    IFS= read -r answer < /dev/tty
    [ "$answer" = "open sesame" ] || { echo "$dest: Permission denied (publickey,password)." >&2; exit 255; }
  fi
fi
cd "${server.home}" || exit 255
exec env -i HOME="${env.HOME}" PATH="${env.PATH}" TMPDIR="${env.TMPDIR}" LC_ALL=C /bin/sh -c "$command"
`
  )
  return {
    path,
    /** Each call, its arguments on one line. */
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []),
    /** SSH would have to ask: batch mode fails, and a call without it goes ahead. */
    ask: () => writeFileSync(asks, ""),
    /** Without batch mode, the stand-in asks for a password on the terminal, and wants "open sesame". */
    askOnTerminal: () => writeFileSync(tty, ""),
    /**
     * With `ask()`, SSH's question is not answered (cancelled, or a wrong
     * password), without touching any terminal: a call without batch mode
     * fails as SSH does then. `false` answers it again.
     */
    unanswered: (yes = true) => (yes ? writeFileSync(unanswered, "") : rmSync(unanswered, { force: true })),
    /** The host refuses connections: every call fails with SSH's own status, as SSH does then, asking nothing. */
    down: () => writeFileSync(down, ""),
  }
}

/** Makes `ssh` mean the stand-in for the length of `work`, as session.test.ts does. */
export async function withSsh<T>(ssh: { path: string }, work: () => Promise<T>): Promise<T> {
  const { spyOn } = await import("bun:test")
  const spawn = Bun.spawn
  const spy = spyOn(Bun, "spawn").mockImplementation(((argv: string[], options: never) =>
    spawn(argv[0] === "ssh" ? [ssh.path, ...argv.slice(1)] : argv, options)) as never)
  try {
    return await work()
  } finally {
    spy.mockRestore()
  }
}
