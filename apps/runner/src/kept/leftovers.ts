/**
 * Images no record will name (specs/016-build-from-source,
 * contracts/runner.md RB11 last two bullets; FR-043, FR-067, SC-012). Every
 * image the runner tags, `zekno.invalid/<app>:<key>`, is either named by the
 * state (in `images` or `drop`, CO13) or removed, so the server never keeps
 * an image nothing can find:
 *
 * - `removeDeployImages`: a deploy that ends `build_failed`, whatever the
 *   reason, records nothing (FR-043), so each image its builds tagged is
 *   removed while its tag still leads to the image that build made.
 * - `removeLeftover`: before B1 builds a key, an image under its tag that
 *   none of the state's digests for that key name (left by a failed deploy,
 *   or by a runner that died) is removed, so the new build's tag never
 *   strands it where nothing can find it.
 *
 * Never with `-f`: an image a container still uses stays, and the failure is
 * reported, never thrown. Each call goes through `runDocker` with its
 * limit, while the runner holds the deploy lock and never the state lock
 * (RB1). `.Id` is the manifest digest on the containerd store and the config
 * digest on the classic one (E01, T10), so both are taken.
 */
import { builtImageName } from "@workspace/core"

import { runDocker } from "../docker/run"

/** The two digests an image the runner made may show as `.Id`, one per image store. */
export type ImageDigests = {
  readonly manifest: string
  readonly config: string
}

/** An image a build of this deploy tagged: its key and the digests its `meta.json` gave. */
export type MadeImage = ImageDigests & { readonly key: string }

/**
 * What became of one build's image: removed; left, since its tag now leads
 * to another image; gone, with no image under its tag; or failed, when
 * Docker refused the removal or did not answer.
 */
export type DeployImageRemoval = {
  readonly key: string
  readonly removal: "removed" | "left" | "gone" | "failed"
}

/**
 * What `removeLeftover` found under a key's tag: a leftover it removed; the
 * image the state records for the key, left; no image at all; or failed,
 * when Docker refused the removal or did not answer.
 */
export type Leftover = "removed" | "recorded" | "none" | "failed"

/** Limits for tests; else `runDocker`'s own 60 seconds a call. */
export type DockerLimit = { readonly timeoutMs?: number }

/**
 * What Docker says is under `tag` now: the image's `.Id`, `gone` when it
 * says there is no such image, or undefined when it did not answer in a way
 * that can be read (an error, a cut, an empty line).
 */
export async function imageIdOf(
  dir: string,
  tag: string,
  limit: DockerLimit = {}
): Promise<{ readonly id: string } | "gone" | undefined> {
  const answer = await runDocker(
    dir,
    ["image", "inspect", "--format", "{{.Id}}", tag],
    limit
  )
  if (answer.code === 0) {
    const id = answer.stdout.trim()
    return id === "" ? undefined : { id }
  }
  return /no such image/i.test(answer.stderr) ? "gone" : undefined
}

/** `docker image rm <tag>`, never with `-f`: true when Docker removed it. */
export async function removeTag(
  dir: string,
  tag: string,
  limit: DockerLimit = {}
): Promise<boolean> {
  const answer = await runDocker(dir, ["image", "rm", tag], limit)
  return answer.code === 0
}

const isOneOf = (id: string, digests: ImageDigests) =>
  id === digests.manifest || id === digests.config

/**
 * RB11's removal for a deploy that ends `build_failed`: for each build of
 * `made`, in order, its tag is inspected, and removed while its `.Id` is
 * that build's manifest or config digest. A tag that leads elsewhere is
 * left; one with no image is gone. Never throws: a removal Docker refuses
 * (a container uses the image) or a Docker that does not answer is
 * `failed`, and the next build's image is still tried.
 */
export async function removeDeployImages(
  dir: string,
  app: string,
  made: readonly MadeImage[],
  limit: DockerLimit = {}
): Promise<DeployImageRemoval[]> {
  const removals: DeployImageRemoval[] = []
  for (const image of made) {
    let removal: DeployImageRemoval["removal"]
    try {
      const tag = builtImageName(app, image.key)
      const found = await imageIdOf(dir, tag, limit)
      if (found === undefined) removal = "failed"
      else if (found === "gone") removal = "gone"
      else if (!isOneOf(found.id, image)) removal = "left"
      else removal = (await removeTag(dir, tag, limit)) ? "removed" : "failed"
    } catch {
      // A name core refuses is never passed to Docker.
      removal = "failed"
    }
    removals.push({ key: image.key, removal })
  }
  return removals
}

/**
 * RB11's removal of a leftover, before B1 builds `key`: when its tag names
 * an image whose `.Id` is none of `recorded` (the digests the state records
 * for the key, in `images` or `drop`; undefined when it records none), that
 * tag is removed. The image the state records is left; it is what K14a
 * keeps. Never throws.
 */
export async function removeLeftover(
  dir: string,
  app: string,
  key: string,
  recorded: ImageDigests | undefined,
  limit: DockerLimit = {}
): Promise<Leftover> {
  try {
    const tag = builtImageName(app, key)
    const found = await imageIdOf(dir, tag, limit)
    if (found === undefined) return "failed"
    if (found === "gone") return "none"
    if (recorded !== undefined && isOneOf(found.id, recorded)) return "recorded"
    return (await removeTag(dir, tag, limit)) ? "removed" : "failed"
  } catch {
    return "failed"
  }
}
