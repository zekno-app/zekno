/**
 * The stand-in's answers about Docker's records, images and Compose without
 * a build (specs/016-build-from-source, T064; contracts/runner.md, "Tests"
 * first bullet, RB10 to RB15, RB17, E08): `buildx history ls`, `inspect`
 * and `rm`, `buildx prune` and `du`, `image inspect` and `image rm` of the
 * images builds tagged (`zekno.invalid/…`), and whether `compose … up
 * --no-build` finds each built image. Answered from the model (`model.ts`)
 * as Docker 29 and buildx print, as far as the runner reads them. Used by
 * `stand-in-buildx.ts`, `stand-in.ts` and `stand-in-compose.ts`.
 */
import {
  builderOf,
  scriptedDocker,
  settle,
  type FakeImage,
  type FakeRecord,
  type Model,
} from "./model"
import { formatOf, render } from "./stand-in-format"
import { fail, out, type Answer } from "./stand-in-proxy"

/** An answer, or a call that never ends until it is stopped. */
export type Reply = Answer & { hang?: boolean }

const BUILT = "zekno.invalid/"

/** The options of these calls that take a value. */
const WITH_VALUE = new Set(["--builder", "--format", "-f", "--filter"])

/** The words that are not options or their values. */
const positional = (words: readonly string[], withValue = WITH_VALUE) =>
  words.filter(
    (word, i) => !word.startsWith("-") && !withValue.has(words[i - 1] ?? "")
  )

/** A size as buildx prints it (go-units' `HumanSize`): decimal units, four figures. */
export function humanSize(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB", "PB"]
  let size = bytes
  let unit = 0
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000
    unit++
  }
  return `${Number(size.toPrecision(4))}${units[unit]}`
}

/** A size as buildx reads it (go-units' `RAMInBytes`): `10gb` is 10 GiB. */
export function bytesOf(text: string): number | undefined {
  const found = /^(\d+(?:\.\d+)?) ?([kmgtp])?i?b?$/i.exec(text.trim())
  if (!found) return undefined
  const power = " kmgtp".indexOf((found[2] ?? " ").toLowerCase())
  return Math.floor(Number(found[1]) * 1024 ** power)
}

/** How long a record ran, as buildx prints it: `3.2s`, `1m 30s`. */
function duration(record: FakeRecord): string {
  const end = record.completedAt ? Date.parse(record.completedAt) : Date.now()
  const ms = Math.max(0, end - Date.parse(record.startedAt))
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

/** Lines of `key: value`, the values in one column, as buildx's printer does. */
const rows = (pairs: [string, string][]) =>
  pairs.map(([key, value]) => `${key.padEnd(16)}${value}`).join("\n")

/** `history inspect --format json`'s words for a record's status. */
const JSON_STATUS: Record<FakeRecord["status"], string> = {
  Running: "running",
  Completed: "completed",
  Error: "failed",
  Canceled: "canceled",
}

/** A record named by its ref, its last part or the whole `<builder>/<node>/<ref>`. */
const recordOf = (model: Model, ref: string) =>
  model.records.find(
    (record) =>
      record.ref === ref ||
      `${record.builder}/${record.node}/${record.ref}` === ref
  )

/** `docker buildx history ls|inspect|rm`: Docker's records of the builds. */
export function history(model: Model, words: string[]): Reply {
  const [verb, ...rest] = words
  const builder = builderOf(rest, scriptedDocker(model))
  for (const record of model.records) settle(record)
  const json = formatOf(rest) === "json"
  if (verb === "ls") {
    const listed = model.records
      .filter((record) => record.builder === builder && !record.deleted)
      .reverse()
    if (json)
      return out(
        listed
          .map((record) =>
            JSON.stringify({
              ref: `${record.builder}/${record.node}/${record.ref}`,
              name: record.name,
              // As check L5 saw buildx 0.34.1 list a canceled build.
              status: record.status === "Canceled" ? "Error" : record.status,
              created_at: record.startedAt,
              ...(record.completedAt
                ? { completed_at: record.completedAt }
                : {}),
              total_steps: record.steps,
              completed_steps: record.steps,
              cached_steps: record.cached,
              ...(record.error
                ? { error: { code: 2, message: record.error } }
                : {}),
            })
          )
          .map((line) => `${line}\n`)
          .join("")
      )
    return out(
      [
        "BUILD ID                    NAME           STATUS      DURATION",
        ...listed.map(
          (record) =>
            `${record.ref.padEnd(28)}${record.name.slice(0, 14).padEnd(15)}${record.status.padEnd(12)}${duration(record)}`
        ),
        "",
      ].join("\n")
    )
  }
  const refs = positional(rest)
  if (verb === "inspect") {
    const ref = refs[0] ?? ""
    const record = recordOf(model, ref)
    if (!record)
      return fail(`ERROR: no record found for ref ${JSON.stringify(ref)}\n`)
    if (record.deleted) return fail(`ERROR: ref ${record.ref} is deleted\n`)
    if (json)
      return out(
        `${JSON.stringify({
          Name: record.name,
          Ref: record.ref,
          Status: JSON_STATUS[record.status],
          StartedAt: record.startedAt,
          ...(record.completedAt ? { CompletedAt: record.completedAt } : {}),
          ...(record.error ? { Error: { Message: record.error } } : {}),
          NumTotalSteps: record.steps,
          NumCompletedSteps: record.steps,
          NumCachedSteps: record.cached,
        })}\n`
      )
    const cached = record.steps
      ? Math.round((100 * record.cached) / record.steps)
      : 0
    return out(
      `${rows([
        ["Name:", record.name],
        ["Started:", record.startedAt.slice(0, 19).replace("T", " ")],
        [
          "Duration:",
          `${duration(record)}${record.status === "Running" ? " (running)" : ""}`,
        ],
        ...(record.status === "Canceled"
          ? [["Status:", "Canceled"] as [string, string]]
          : []),
        ...(record.status === "Error"
          ? [["Error:", `Unknown ${record.error ?? ""}`] as [string, string]]
          : []),
        ["Build Steps:", `${record.steps}/${record.steps} (${cached}% cached)`],
      ])}\n`
    )
  }
  if (verb === "rm") {
    for (const ref of refs) {
      const record = recordOf(model, ref)
      if (!record || record.deleted)
        return fail(`ERROR: no record found for ref ${JSON.stringify(ref)}\n`)
      if ((model.script.historyRmFails ?? 0) > 0) {
        model.script.historyRmFails! -= 1
        return fail(
          `ERROR: failed to delete ref ${record.ref}: device or resource busy\n`
        )
      }
      // Never a build that still runs: the runner removes only records that ended (RB12, RB15).
      if (record.status === "Running")
        return fail(`ERROR: ref ${record.ref} is still running\n`)
      record.deleted = true
    }
    return {}
  }
  return fail(
    `the stand-in does not know docker buildx history ${words.join(" ")}\n`
  )
}

/** The value of one size option, `--name value` or `--name=value`. */
function sizeOption(
  words: readonly string[],
  name: string
): number | undefined {
  for (let i = 0; i < words.length; i++) {
    if (words[i] === name) return bytesOf(words[i + 1] ?? "")
    if (words[i]!.startsWith(`${name}=`))
      return bytesOf(words[i]!.slice(name.length + 1))
  }
  return undefined
}

/** `docker buildx prune`: its options recorded; the cache brought within the bound, or emptied without one. */
export function prune(model: Model, words: string[]): Reply {
  model.prunes.push(words)
  const flag = words.find((word) => word.startsWith("--max-used-space"))
  if (flag && !scriptedDocker(model).maxUsedSpace)
    return fail(
      "unknown flag: --max-used-space\nSee 'docker buildx prune --help'.\n"
    )
  if (model.script.pruneHangs) return { hang: true }
  const total = model.script.du ?? 0
  const bound =
    sizeOption(words, "--max-used-space") ??
    sizeOption(words, "--keep-storage") ??
    0
  const left = Math.min(total, bound)
  model.script.du = left
  return out(`Total:\t${humanSize(total - left)}\n`)
}

/** `docker buildx du`: the build cache every app on the server shares. */
export function du(model: Model): Reply {
  const total = humanSize(model.script.du ?? 0)
  return out(
    `${rows([
      ["Shared:", "0B"],
      ["Private:", total],
      ["Reclaimable:", total],
      ["Total:", total],
    ])}\n`
  )
}

/** Whether an `image` call names an image builds tag: a `zekno.invalid/` reference. */
export const namesBuilt = (words: readonly string[]): boolean =>
  words.some((word) => word.startsWith(BUILT))

const noSuchImage = (ref: string) =>
  `Error response from daemon: No such image: ${ref}\n`

/** What `docker image inspect` shows of an image builds tagged. */
const shown = (image: FakeImage) => ({
  Id: image.id,
  RepoTags: [image.tag],
  RepoDigests: [],
  Architecture: image.architecture,
  Os: "linux",
  Size: image.size,
})

/** `docker image inspect` and `docker image rm` of `zekno.invalid/` tags. */
export function image(model: Model, words: string[]): Reply {
  const [verb, ...rest] = words
  if (verb === "inspect") {
    const template = formatOf(rest)
    let stdout = ""
    let stderr = ""
    const found: ReturnType<typeof shown>[] = []
    for (const ref of positional(rest)) {
      const kept = model.images.find((each) => each.tag === ref)
      if (!kept) stderr += noSuchImage(ref)
      else found.push(shown(kept))
    }
    if (template === undefined) stdout = `${JSON.stringify(found)}\n`
    else
      for (const each of found) {
        const filled = render(template, each)
        stdout += "error" in filled ? "" : `${filled.text}\n`
      }
    return { code: stderr ? 1 : 0, stdout, stderr }
  }
  if (verb === "rm") {
    const force = rest.includes("-f") || rest.includes("--force")
    let stdout = ""
    let stderr = ""
    // `-f` here is the force, not a format: no option takes a value.
    for (const ref of positional(rest, new Set())) {
      const kept = model.images.find((each) => each.tag === ref)
      if (!kept) {
        stderr += noSuchImage(ref)
        continue
      }
      const user = model.containers.find(
        (c) => c.image === kept.tag || c.image === kept.id
      )
      if (user && !force) {
        stderr += `Error response from daemon: conflict: unable to remove repository reference "${ref}" (must force) - container ${user.id.slice(0, 12)} is using its referenced image ${kept.id.slice(7, 19)}\n`
        continue
      }
      model.images = model.images.filter((each) => each !== kept)
      stdout += `Untagged: ${kept.tag}\nDeleted: ${kept.id}\n`
    }
    return { code: stderr ? 1 : 0, stdout, stderr }
  }
  return fail(`the stand-in does not know docker image ${words.join(" ")}\n`)
}

/**
 * What `compose … up --no-build` says when a service's image is a built one
 * the model does not have: it refuses, as E08 saw, instead of building. A
 * registry image is pulled as before, so it never refuses here.
 */
export function composeRefusal(
  model: Model,
  compose: string
): string | undefined {
  const named = [...compose.matchAll(/^\s*image:\s*["']?([^"'\s#]+)/gm)].map(
    (found) => found[1]!
  )
  const missing = named.find(
    (ref) =>
      ref.startsWith(BUILT) && !model.images.some((each) => each.tag === ref)
  )
  return missing === undefined ? undefined : noSuchImage(missing)
}
