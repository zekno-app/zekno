/**
 * K14a: whether each build of a deploy is kept (specs/016-build-from-source,
 * contracts/runner.md RB3 K14a, RB4 first bullet, RB14 last paragraph;
 * FR-061, FR-062, FR-064). A build is kept, and is not built again, when the
 * state records its key for the app, in `images` or in `drop` (CO13), and
 * the image under its tag, `zekno.invalid/<app>:<key>`, is still the one the
 * runner made: its `.Id` equals the manifest digest or the config digest
 * recorded for it. The containerd store gives the manifest digest as `.Id`,
 * the classic store the config digest (E01, T10; check L4 runs both).
 *
 * For a key the state recorded and whose image is not there as it was,
 * `gone` (Docker has no such image) or `changed` (the tag leads to another
 * image, retagged by hand) feeds `pack_missing`'s `missing.images` (RB4), so
 * a rollback whose images were removed says why it needs its pieces again.
 *
 * Each call goes through `runDocker` with its 60-second limit, while the
 * runner holds the deploy lock and never the state lock (RB1).
 */
import { builtImageName, type StoredRunnerState } from "@workspace/core"

import { runDocker } from "../docker/run"

/** Whether a build is kept, and, for a key the state recorded, what became of its image. */
export type Reuse =
  | { readonly key: string; readonly reuse: "kept" }
  | {
      readonly key: string
      readonly reuse: "not_kept"
      /** Only for a key the state recorded: no image under the tag, or another one. */
      readonly image?: "gone" | "changed"
    }

/** One recorded image, as `pack_missing`'s `missing.images` names it (CO10). */
export type MissingImage = {
  readonly key: string
  readonly state: "gone" | "changed"
}

/** What Docker says of the image under one tag: its `.Id`, none, or no answer. */
async function imageId(
  dir: string,
  name: string
): Promise<{ id: string } | "gone" | undefined> {
  const result = await runDocker(dir, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    name,
  ])
  if (result.code === 0) return { id: result.stdout.trim() }
  return /no such image/i.test(result.stderr) ? "gone" : undefined
}

/**
 * K14a for each of `builds`, in the order given. A key the state never
 * recorded for `app` is `not_kept` without asking Docker: only an image the
 * runner made and recorded can be kept. A recorded key is `kept` when
 * `.Id` equals one of its digests; `not_kept` with `gone` or `changed` when
 * Docker says the image is missing or another; and `not_kept` alone when
 * Docker did not answer, since then nothing is known of the image. `dir` is
 * the runner's folder, where Docker runs.
 */
export async function keptBuilds(
  dir: string,
  state: Pick<StoredRunnerState, "builds">,
  app: string,
  builds: readonly { readonly key: string }[]
): Promise<Reuse[]> {
  const entry = state.builds[app]
  const recorded = [...(entry?.images ?? []), ...(entry?.drop ?? [])]
  const reuse: Reuse[] = []
  for (const { key } of builds) {
    const image = recorded.find((each) => each.key === key)
    if (image === undefined) {
      reuse.push({ key, reuse: "not_kept" })
      continue
    }
    const found = await imageId(dir, builtImageName(app, key))
    if (found === undefined) reuse.push({ key, reuse: "not_kept" })
    else if (found === "gone")
      reuse.push({ key, reuse: "not_kept", image: "gone" })
    else if (found.id === image.manifest || found.id === image.config)
      reuse.push({ key, reuse: "kept" })
    else reuse.push({ key, reuse: "not_kept", image: "changed" })
  }
  return reuse
}

/** The recorded builds whose image is gone or changed, sorted by key and each once: `missing.images` (CO10). */
export function missingImages(reuse: readonly Reuse[]): MissingImage[] {
  const byKey = new Map<string, MissingImage>()
  for (const each of reuse)
    if (each.reuse === "not_kept" && each.image !== undefined)
      byKey.set(each.key, { key: each.key, state: each.image })
  return [...byKey.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  )
}
