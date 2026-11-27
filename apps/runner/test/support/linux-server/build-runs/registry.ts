/**
 * The check's registry (specs/016-build-from-source, T011; plan item 3 (a)):
 * Ubuntu's own `docker-registry`, at the version pins.json names, which
 * `server.ts up` installs in the stand-in, run there on 127.0.0.1:5000, with
 * or without an htpasswd file, every request it serves in its log. Checks L2
 * (T011), L8 (T015) and L13 (T018) use it. Every command runs in the
 * stand-in, through `gate.ts`; the registry is reachable only from there.
 *
 * How to use, in a check file whose gate is open:
 *
 *   const registry = await startRegistry(open.inStandIn)   // or { htpasswd: "user:$2b$..." }
 *   try {
 *     const image = await smallImage(open.inStandIn, "zekno-check-x-source:1")
 *     const pushed = await registry.push(image.name, "check/frontend:1")
 *     await image.remove()        // pushed.reference, pushed.digest
 *     const mark = await registry.mark()
 *     // ... a build that may ask for 127.0.0.1:5000/check/frontend:1 ...
 *     const asked = await registry.requestsSince(mark, "check/frontend")
 *     requestWords(asked, "check/frontend")   // for the record line
 *   } finally {
 *     await registry.stop()
 *   }
 *
 * With htpasswd, the check logs the stand-in's Docker in before `push`
 * (`docker login --password-stdin 127.0.0.1:5000`) and out after. `push`
 * removes its tag from the stand-in's Docker once pushed, so a later build
 * asks the registry and never finds the name locally. `startRegistry` first
 * stops a registry an earlier check left and empties its folders; `stop`
 * kills it by its pid file and removes its files, by name.
 */
import { firstLine } from "../host/host-lists"
import { loadPins } from "../pins"
import type { InStandIn } from "./rb7"
import { q } from "../stand-in/shell"

export const REGISTRY = "127.0.0.1:5000"

/** Where the registry keeps its things in the stand-in. */
export const REGISTRY_FILES = {
  folder: "/etc/zekno-check-registry",
  config: "/etc/zekno-check-registry/config.yml",
  htpasswd: "/etc/zekno-check-registry/htpasswd",
  data: "/var/lib/zekno-check-registry",
  log: "/var/log/zekno-check-registry.log",
  pid: "/run/zekno-check-registry.pid",
} as const

const F = REGISTRY_FILES
const MINUTE = 60_000
/** How long the log is given to hold a request a build just made. */
export const SETTLE_MS = 1000

const COMPONENT = "[a-z0-9]+(?:[._-][a-z0-9]+)*"
const REPOSITORY = new RegExp(`^${COMPONENT}(?:/${COMPONENT})*$`)
const NAME = new RegExp(
  `^(${COMPONENT}(?:/${COMPONENT})*):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$`
)
/** One htpasswd line: a user and a bcrypt hash. */
const HTPASSWD_LINE = /^[A-Za-z0-9._-]+:\$2[aby]?\$[0-9]{2}\$[./A-Za-z0-9]{53}$/

/** `repository:tag`, as the registry stores it; anything else throws. */
export function checkName(name: string): { repository: string; tag: string } {
  const found = NAME.exec(name)
  if (!found)
    throw new Error(`${JSON.stringify(name)} is not a repository and a tag`)
  return { repository: found[1]!, tag: found[2]! }
}

/** `127.0.0.1:5000/<repository:tag>`. */
export function inRegistry(name: string): string {
  checkName(name)
  return `${REGISTRY}/${name}`
}

/** The registry's configuration: its folder, its address, its access log, and htpasswd when asked. */
export function registryConfig(htpasswd: boolean): string {
  return [
    "version: 0.1",
    "log:",
    "  level: info",
    "  formatter: text",
    "  accesslog:",
    "    disabled: false",
    "storage:",
    "  filesystem:",
    `    rootdirectory: ${F.data}`,
    "  delete:",
    "    enabled: true",
    "http:",
    `  addr: ${REGISTRY}`,
    ...(htpasswd
      ? [
          "auth:",
          "  htpasswd:",
          "    realm: zekno-check",
          `    path: ${F.htpasswd}`,
        ]
      : []),
  ].join("\n")
}

/** Stops the registry its pid file names, if that process is docker-registry, and removes its files. */
export const STOP_LINES: readonly string[] = [
  `if [ -f ${F.pid} ]; then`,
  `  pid=$(cat ${F.pid})`,
  '  if [ "$(cat "/proc/$pid/comm" 2> /dev/null || :)" = docker-registry ]; then',
  '    kill "$pid" 2> /dev/null || :',
  "    i=0",
  '    while kill -0 "$pid" 2> /dev/null; do',
  "      i=$((i + 1))",
  '      if [ "$i" -eq 20 ]; then kill -9 "$pid" 2> /dev/null || :; fi',
  '      if [ "$i" -gt 30 ]; then echo "docker-registry ($pid) did not stop" >&2; exit 1; fi',
  "      sleep 1",
  "    done",
  "  fi",
  "fi",
  `rm -rf ${F.folder} ${F.data} ${F.log} ${F.pid}`,
]

const logTail = `tail -n 20 ${F.log} >&2`

/** The `sh` script that starts the registry from empty and waits until it answers. */
export function startScript(htpasswd?: string): string {
  if (htpasswd !== undefined) {
    const lines = htpasswd.split("\n").filter((line) => line !== "")
    if (lines.length === 0 || !lines.every((line) => HTPASSWD_LINE.test(line)))
      throw new Error("the htpasswd file holds lines of user:<bcrypt hash>")
  }
  return [
    "set -eu",
    ...STOP_LINES,
    `install -d -m 0755 ${F.folder} ${F.data}`,
    `printf '%s\\n' ${q(registryConfig(htpasswd !== undefined))} > ${F.config}`,
    ...(htpasswd === undefined
      ? []
      : [
          `printf '%s\\n' ${q(htpasswd.trim())} > ${F.htpasswd}`,
          `chmod 0600 ${F.htpasswd}`,
        ]),
    `: > ${F.log}`,
    `setsid docker-registry serve ${F.config} >> ${F.log} 2>&1 < /dev/null &`,
    "pid=$!",
    `echo "$pid" > ${F.pid}`,
    "i=0",
    "while :; do",
    `  code=$(curl --silent --output /dev/null --write-out '%{http_code}' http://${REGISTRY}/v2/ || :)`,
    '  if [ "$code" = 200 ] || [ "$code" = 401 ]; then break; fi',
    `  if ! kill -0 "$pid" 2> /dev/null; then echo "docker-registry stopped before it answered; the end of its log:" >&2; ${logTail}; exit 1; fi`,
    "  i=$((i + 1))",
    `  if [ "$i" -gt 30 ]; then echo "docker-registry did not answer within 30 seconds; the end of its log:" >&2; ${logTail}; exit 1; fi`,
    "  sleep 1",
    "done",
    `if [ "$(cat "/proc/$pid/comm" 2> /dev/null || :)" != docker-registry ]; then echo "what answers on ${REGISTRY} is not the docker-registry this started" >&2; ${logTail}; exit 1; fi`,
  ].join("\n")
}

/**
 * The requests for `repository` in the registry's log, `METHOD /v2/...`,
 * each once, in order: from the access log's lines, or the application's
 * own `http.request.method` and `http.request.uri`, quoted or not.
 */
export function requestsFor(log: string, repository: string): string[] {
  if (!REPOSITORY.test(repository))
    throw new Error(`${JSON.stringify(repository)} is not a repository`)
  const prefix = `/v2/${repository}/`
  const found: string[] = []
  for (const line of log.split("\n")) {
    const access = /"([A-Z]+) (\/[^ "]*) HTTP\/[0-9.]+"/.exec(line)
    const method = /\bhttp\.request\.method="?([A-Z]+)/.exec(line)
    const uri = /\bhttp\.request\.uri=(?:"([^"]*)"|([^\s"]+))/.exec(line)
    const request = access
      ? `${access[1]} ${access[2]}`
      : method && uri
        ? `${method[1]} ${uri[1] ?? uri[2]}`
        : undefined
    if (
      request !== undefined &&
      request.split(" ")[1]!.startsWith(prefix) &&
      !found.includes(request)
    )
      found.push(request)
  }
  return found
}

/** For a record line: `no request for <repository>`, or the first requests. */
export function requestWords(
  requests: readonly string[],
  repository: string
): string {
  if (requests.length === 0) return `no request for ${repository}`
  const shown = requests.slice(0, 3).join(", ")
  const more = requests.length > 3 ? ` and ${requests.length - 3} more` : ""
  return `${repository} requested (${shown}${more})`
}

/** The digest `docker push` printed last: `1: digest: sha256:<64 hex> size: 527`. */
export function pushedDigest(output: string): string | undefined {
  return [...output.matchAll(/\bdigest: (sha256:[0-9a-f]{64})\b/g)].at(-1)?.[1]
}

/** The size `stat -c %s` printed. */
export function byteCount(stdout: string): number {
  const text = stdout.trim()
  if (!/^[0-9]+$/.test(text))
    throw new Error(`stat gave ${JSON.stringify(text)}, not a size`)
  return Number(text)
}

async function must(
  run: InStandIn,
  args: readonly string[],
  what: string,
  timeoutMs?: number
) {
  const answer = await run(args, timeoutMs === undefined ? {} : { timeoutMs })
  if (answer.code !== 0)
    throw new Error(
      `${what} failed (exit ${answer.code}): ${firstLine(answer)}`
    )
  return answer
}

/** Removes an image of the stand-in's Docker by name; one that is not there is no fault. */
async function removeImage(run: InStandIn, name: string): Promise<void> {
  const answer = await run(["docker", "image", "rm", name])
  if (answer.code !== 0 && !/no such image/i.test(answer.stderr))
    throw new Error(`the removal of ${name} failed: ${firstLine(answer)}`)
}

export type Registry = {
  /** Tags `from` as `127.0.0.1:5000/<name>`, pushes it, and removes that tag here again. */
  push(
    from: string,
    name: string
  ): Promise<{ reference: string; digest: string | undefined }>
  /** Where the log ends now, for `requestsSince`. */
  mark(): Promise<number>
  /** The requests for `repository` logged after `mark`. */
  requestsSince(mark: number, repository: string): Promise<string[]>
  /** Kills the registry and removes its files. */
  stop(): Promise<void>
}

/** Stops a registry this file started, by its pid file, and removes its files. */
export async function stopRegistry(run: InStandIn): Promise<void> {
  await must(
    run,
    ["sh", "-c", ["set -eu", ...STOP_LINES].join("\n")],
    "stopping the check's registry"
  )
}

/** Starts the check's registry in the stand-in, empty, and waits until it answers. */
export async function startRegistry(
  run: InStandIn,
  options: { readonly htpasswd?: string } = {}
): Promise<Registry> {
  await must(
    run,
    ["sh", "-c", startScript(options.htpasswd)],
    "starting the check's registry",
    2 * MINUTE
  )
  return {
    async push(from, name) {
      const reference = inRegistry(name)
      await must(run, ["docker", "tag", from, reference], `docker tag ${from}`)
      try {
        const pushed = await must(
          run,
          ["docker", "push", reference],
          `docker push ${reference}`,
          5 * MINUTE
        )
        return { reference, digest: pushedDigest(pushed.stdout) }
      } finally {
        await removeImage(run, reference)
      }
    },
    async mark() {
      const answer = await must(
        run,
        ["stat", "-c", "%s", F.log],
        "reading the registry's log"
      )
      return byteCount(answer.stdout)
    },
    async requestsSince(mark, repository) {
      if (!Number.isSafeInteger(mark) || mark < 0)
        throw new Error("a mark is a size that mark() gave")
      await Bun.sleep(SETTLE_MS)
      const answer = await must(
        run,
        ["tail", "-c", `+${mark + 1}`, F.log],
        "reading the registry's log"
      )
      return requestsFor(answer.stdout, repository)
    },
    stop: () => stopRegistry(run),
  }
}

/** The container a small image is committed from; removed once committed. */
export const SOURCE_CONTAINER = "zekno-check-small-image"

export type SmallImage = {
  readonly name: string
  /** Removes the image, and the fixtures' base when `smallImage` pulled it. */
  remove(): Promise<void>
}

/**
 * A small image named `name` in the stand-in's Docker, made from the
 * fixtures' base (pins.json, by digest; pulled when it is not there): a
 * container made from it and never started, committed with a label, then
 * removed. One platform only, so it pushes on either store.
 */
export async function smallImage(
  run: InStandIn,
  name: string,
  base: string = loadPins().images.fixtures.image
): Promise<SmallImage> {
  checkName(name)
  const present = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    base,
  ])
  const pulled = present.code !== 0
  if (pulled)
    await must(
      run,
      ["docker", "pull", "--quiet", base],
      `docker pull ${base}`,
      10 * MINUTE
    )
  const removeBase = async () => {
    if (pulled) await removeImage(run, base)
  }
  try {
    await run(["docker", "rm", "--force", SOURCE_CONTAINER])
    try {
      await must(
        run,
        ["docker", "create", "--name", SOURCE_CONTAINER, base],
        `docker create from ${base}`
      )
      await must(
        run,
        [
          "docker",
          "commit",
          "--change",
          "LABEL zekno.check=small-image",
          SOURCE_CONTAINER,
          name,
        ],
        `docker commit as ${name}`
      )
    } finally {
      await run(["docker", "rm", "--force", SOURCE_CONTAINER])
    }
  } catch (error) {
    await removeBase()
    throw error
  }
  return {
    name,
    async remove() {
      await removeImage(run, name)
      await removeBase()
    },
  }
}
