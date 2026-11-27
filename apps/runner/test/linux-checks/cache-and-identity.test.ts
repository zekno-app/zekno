/**
 * Checks L3, L4 and L4b, in record mode (specs/016-build-from-source, T012;
 * FR-035, FR-061, plan item 14; plan, "Decisions where the maps differ",
 * "How an image is known again"; research map-runner E01, E05, E07 and
 * map-checks T10). They run only in the Linux stand-in `gate.ts` names;
 * without ZEKNO_LINUX_SERVER the file prints its one skip line. Each asserts
 * nothing about Docker: it prints one record line, `<id> <engine> <store>:
 * ...`, and fails only on its own fault (a step of its own that could not be
 * done, or something it made that it could not remove). `jobs.ts` says
 * which of the three run on the leg run-checks.ts started: L3 and L4 in
 * `checks` at the floor on both stores and in `older-engine`, L4b in
 * `checks` at the floor.
 *
 * Every build is RB7's list (`rb7.ts`) from a tar on standard input, FROM
 * the fixtures' base by digest (pulled when the stand-in lacks it), and
 * every pack holds a token of the run, so no earlier build stands in for a
 * first one.
 *
 * L3 (FR-035): app `check-cache-a` (`BUILDKIT_CACHE_MOUNT_NS=zekno-check-cache-a`)
 * writes a file into `RUN --mount=type=cache,target=/cache`; app
 * `check-cache-b` runs the same step: does it see the file; `a` again: does
 * it. L4 (FR-061): one build with `--iidfile` and `--metadata-file`: the
 * iidfile, `.Id`, the metadata's `containerimage.digest` and
 * `containerimage.config.digest`, and which are equal; the same pack again:
 * whether every step was cached and `.Id` unchanged. L4b (item 14): two
 * tars of the same content, every header time a day apart: whether the
 * second build's `COPY` was cached.
 *
 * Every command runs in the stand-in. Each check removes what it made
 * there, by name, also after a failure (`check-made.ts`): its images, its
 * build records, the build cache made since it began, the base when it
 * pulled it, and its folder.
 */
import { describe, test } from "bun:test"

import {
  cachedWords,
  progressOfAnswer,
  stepNamed,
  stepsOf,
  taggedLine,
} from "../support/linux-server/build-runs/build-progress"
import {
  BUILD_ARG,
  CACHE_TAG,
  cacheMountDockerfile,
  identityPack,
  sawOf,
  sawWords,
  seenList,
  timesPacks,
} from "../support/linux-server/checks/build-reuse"
import {
  prepare,
  recordCheck,
  type Made,
} from "../support/linux-server/build-runs/check-made"
import {
  digestIn,
  ensureImage,
  identityWords,
  metadataDigests,
  shortDigest,
} from "../support/linux-server/build-runs/check-images"
import { gate } from "../support/linux-server/gate"
import { runsHere } from "../support/linux-server/jobs/jobs"
import { loadPins } from "../support/linux-server/pins"
import {
  builtName,
  type InStandIn,
  newRunToken,
  outcomeWords,
  type PackFile,
  rb7Build,
  type Rb7Options,
  refOf,
} from "../support/linux-server/build-runs/rb7"

const open = gate("L3, L4 and L4b")
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const FIXTURES = loadPins().images.fixtures.image

/** What every check of this file does first: `prepare`, then the base. */
async function begin(
  run: InStandIn,
  made: Made,
  root: string
): Promise<{ home: string; buildx: string; base: string } | { none: string }> {
  const prepared = await prepare(run, made, root)
  if ("none" in prepared) return prepared
  const base = await ensureImage(run, FIXTURES)
  made.bases.push(base)
  return { ...prepared, base: base.image }
}

/** One build of RB7's list, its image and record noted for the removal. */
async function build(
  run: InStandIn,
  made: Made,
  home: string,
  options: Rb7Options,
  files: readonly PackFile[],
  extra: readonly string[] = []
) {
  made.images.push(builtName(options))
  const built = await rb7Build(run, { options, home, files, extra })
  made.homes.get(home)?.push(refOf(built.metadata))
  return { built, progress: progressOfAnswer(built.answer) }
}

/** L3: each app's cache mount, seen from another app and from its own. */
async function cacheMounts(run: InStandIn, made: Made): Promise<string> {
  const root = "/tmp/zekno-check-cache-mounts"
  const started = await begin(run, made, root)
  if ("none" in started) return started.none
  const { home, base, buildx } = started
  const token = newRunToken().slice(0, 12)
  const files = [
    { path: "Dockerfile", data: cacheMountDockerfile(base, token) },
  ]
  const step = async (app: string, name: string) => {
    const { built, progress } = await build(
      run,
      made,
      home,
      {
        app,
        key: name,
        dockerfile: "Dockerfile",
        network: "default",
        work: `${root}/${name}`,
        args: [[BUILD_ARG, name]],
      },
      files
    )
    const saw = sawOf(taggedLine(progress, CACHE_TAG), token)
    return { outcome: outcomeWords(built), saw }
  }
  const a1 = await step("check-cache-a", "a1")
  const b1 = await step("check-cache-b", "b1")
  const a2 = await step("check-cache-a", "a2")
  return [
    buildx,
    `zekno-check-cache-a's first build ${a1.outcome}, ${seenList(a1.saw)}, wrote a1`,
    `zekno-check-cache-b, the same step: ${b1.outcome}, ${sawWords(b1.saw, "a1")}`,
    `zekno-check-cache-a again: ${a2.outcome}, ${sawWords(a2.saw, "a1")}`,
  ].join("; ")
}

/** L4: the image's identity, and the same pack again. */
async function imageIdentity(run: InStandIn, made: Made): Promise<string> {
  const root = "/tmp/zekno-check-image-identity"
  const started = await begin(run, made, root)
  if ("none" in started) return started.none
  const { home, base, buildx } = started
  const files = identityPack(base, newRunToken().slice(0, 12))
  const options = (work: string): Rb7Options => ({
    app: "check-identity",
    key: "k1",
    dockerfile: "Dockerfile",
    network: "default",
    work: `${root}/${work}`,
  })
  const inspect = async (name: string) =>
    digestIn(
      (await run(["docker", "image", "inspect", "--format", "{{.Id}}", name]))
        .stdout
    )
  const once = async (work: string) => {
    const iid = `${root}/${work}/iid`
    const { built, progress } = await build(
      run,
      made,
      home,
      options(work),
      files,
      ["--iidfile", iid]
    )
    const iidfile = built.built
      ? digestIn((await run(["cat", iid])).stdout)
      : undefined
    const id = built.built ? await inspect(builtName(options(work))) : undefined
    return { built, progress, iidfile, id }
  }
  const first = await once("first")
  if (!first.built.built)
    return `${buildx}; the build ${outcomeWords(first.built)}`
  const seen = identityWords({
    iidfile: first.iidfile,
    id: first.id,
    ...metadataDigests(first.built.metadata),
  })
  const second = await once("second")
  if (!second.built.built)
    return `${buildx}; the first build built: ${seen}; the same pack again ${outcomeWords(second.built)}`
  const same = (now?: string, then?: string) =>
    now === undefined
      ? "unread"
      : now === then
        ? "unchanged"
        : `changed to ${shortDigest(now)}`
  return [
    buildx,
    `the first build built: ${seen}`,
    `the same pack again built: ${cachedWords(stepsOf(second.progress))}, .Id ${same(second.id, first.id)}, the iidfile ${same(second.iidfile, first.iidfile)}`,
  ].join("; ")
}

/** L4b: the same content in two tars whose header times differ by a day. */
async function fileTimes(run: InStandIn, made: Made): Promise<string> {
  const root = "/tmp/zekno-check-file-times"
  const started = await begin(run, made, root)
  if ("none" in started) return started.none
  const { home, base, buildx } = started
  const [early, late] = timesPacks(base, newRunToken().slice(0, 12))
  const copy = async (key: string, files: readonly PackFile[]) => {
    const { built, progress } = await build(
      run,
      made,
      home,
      {
        app: "check-file-times",
        key,
        dockerfile: "Dockerfile",
        network: "default",
        work: `${root}/${key}`,
      },
      files
    )
    const step = stepNamed(progress, "COPY a.txt")
    const words =
      step === undefined
        ? "no COPY step read"
        : `its COPY ${step.cached ? "cached" : "not cached"}`
    return `${outcomeWords(built)}, ${words}`
  }
  return [
    buildx,
    `the tar timed 2026-11-27: ${await copy("t1", early)}`,
    `the same content timed a day later: ${await copy("t2", late)}`,
  ].join("; ")
}

describe.skipIf(!open.ready)(
  "L3, L4 and L4b: cache mounts by app, an image's identity, file times and the cache (record mode)",
  () => {
    test.skipIf(!runsHere("L3"))(
      "L3 records whether one app's cache mount is seen by another",
      async () => {
        if (open.ready) await recordCheck("L3", open.inStandIn, cacheMounts)
      },
      20 * MINUTE
    )

    test.skipIf(!runsHere("L4"))(
      "L4 records the iidfile, .Id and the metadata's digests, and the same pack again",
      async () => {
        if (open.ready) await recordCheck("L4", open.inStandIn, imageIdentity)
      },
      20 * MINUTE
    )

    test.skipIf(!runsHere("L4b"))(
      "L4b records whether a COPY is cached when only the file times differ",
      async () => {
        if (open.ready) await recordCheck("L4b", open.inStandIn, fileTimes)
      },
      20 * MINUTE
    )
  }
)
