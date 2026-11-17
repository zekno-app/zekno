/**
 * The sources a template's image may come from (specs/012-templates, FR-002;
 * contracts/template-file.md, "The allowed sources"), each with how its
 * images are written. An image is pinned when it ends with `@sha256:` and 64
 * lowercase hex digits (TF21) and names a tag (TF22); its source is allowed
 * when it is written as one entry of the list writes its images (TF23).
 *
 * Changing this list is a change of code, reviewed as code, and it is the
 * maintainer's decision, in a pull request of its own
 * (contracts/contributing.md, CG7): an entry here lets every template name
 * images from that source.
 */

/** One allowed source of images. */
export type Publisher = {
  name: "Docker Official Images"
  registry: "docker.io"
  namespace: "library"
  /** How an image of this source is written in a template: name, tag and digest, nothing else. */
  written: RegExp
}

/** The allowed sources. This version lists one: Docker Official Images, `<name>:<tag>@sha256:<64 hex>`, no registry and no `/`. */
export const PUBLISHERS: readonly Publisher[] = [
  {
    name: "Docker Official Images",
    registry: "docker.io",
    namespace: "library",
    written:
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[0-9a-f]{64}$/,
  },
]

/** The allowed source an image is written for, or undefined (TF23). */
export const publisherOf = (image: string): Publisher | undefined =>
  PUBLISHERS.find((publisher) => publisher.written.test(image))

/** Whether an image is pinned: it ends with `@sha256:` and 64 lowercase hex digits (TF21). */
export const isPinned = (image: string): boolean =>
  /@sha256:[0-9a-f]{64}$/.test(image)

/** The tag an image names, without its digest, or undefined (TF22; TF30 compares it with `software`). */
export function tagOf(image: string): string | undefined {
  const at = image.indexOf("@")
  const named = at === -1 ? image : image.slice(0, at)
  const colon = named.lastIndexOf(":")
  return colon > named.lastIndexOf("/") ? named.slice(colon + 1) : undefined
}
