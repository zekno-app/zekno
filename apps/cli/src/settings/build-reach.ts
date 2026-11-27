/**
 * Where `source.root` leads, and the folders zekno never sends
 * (specs/016-build-from-source, contracts/cli.md CL1, "Reading", and CL2,
 * "The root"; FR-009; tasks T111).
 *
 * The reach needs the disk, so the settings reader checks it right after
 * the schema (`checkReach`): through real paths, a root is the settings
 * file's folder, one inside it, or, in a git repository, any folder inside
 * that repository's top, which is how far above the file it may go; outside
 * a repository, the file's folder or one inside it. Beyond that is C22, in
 * its form for a repository or for none; a link on the way that leads out
 * is C23. The top is the one `git/find.ts` finds from the files alone: git
 * is never run (plan item 9 (a)).
 *
 * `rootRefusal` is the check before signing (a deploy, `zekno settings
 * compose`, from step 2 `zekno settings plan`): a root that is, or holds,
 * the person's home folder or zekno's own (C21b). A home folder kept in git
 * would otherwise be in reach of a cloned settings file.
 *
 * The folder is the person's, maybe a cloned repository's: nothing found in
 * it is run, and each part is resolved by the system as a walk would, so a
 * link is judged by where it really leads.
 */
import { realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"

import { findGit } from "../git/find"
import { sanitize } from "../server/sanitize"
import type { LineOf } from "../shared/build-lines"
import type { BuildFault } from "./build-faults"
import type { Settings } from "./types"

/** The real path of the top of the git repository a folder is in, or undefined outside one. */
export type FindTop = (folder: string) => string | undefined

/** The top of the work tree `git/find.ts` finds from a folder (CL4 step 1). */
export const gitTop: FindTop = (folder) => findGit(folder)?.top

/** Where a root leads, or why it may not be sent. */
export type Reach =
  { folder: string } | { id: "C22"; repository: boolean } | { id: "C23" }

/** Whether `path` is `folder` or inside it. */
const within = (folder: string, path: string): boolean =>
  path === folder ||
  path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)

/**
 * The real path a root leads to from `start` (a real path): each part as the
 * system resolves it, a link followed where it leads and `..` after it taken
 * from there. From the first part that is not there yet, the rest is joined
 * as written.
 */
function walk(start: string, root: string): string {
  const parts = root.split("/")
  let here = start
  for (const [at, part] of parts.entries()) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      here = dirname(here)
      continue
    }
    const next = join(here, part)
    try {
      here = realpathSync(next)
    } catch {
      return resolve(next, ...parts.slice(at + 1))
    }
  }
  return here
}

/**
 * Where `root` leads from the folder of the settings file `settingsFile`, or
 * C22 or C23. `findTop` finds the repository's top (`gitTop`).
 */
export function rootReach(
  settingsFile: string,
  root: string,
  findTop: FindTop = gitTop
): Reach {
  const start = realpathSync(dirname(settingsFile))
  const top = findTop(start)
  const repository = top !== undefined
  // The schema refuses these first (`root_form`); never followed if one reaches here.
  if (isAbsolute(root) || root.includes("\\")) return { id: "C22", repository }
  const region = top === undefined ? start : realpathSync(top)
  const real = walk(start, root)
  if (within(region, real)) return { folder: real }
  return within(region, resolve(start, root))
    ? { id: "C23" }
    : { id: "C22", repository }
}

/**
 * The first built service, in the file's order, whose root leads beyond its
 * reach, as a fault of the file; undefined when every root is in reach. A
 * built service with no root sends the settings file's folder.
 */
export function checkReach(
  settingsFile: string,
  settings: Settings,
  findTop: FindTop = gitTop
): BuildFault | undefined {
  for (const [service, settingsOf] of settings.services) {
    if (settingsOf.build === undefined) continue
    const reach = rootReach(settingsFile, settingsOf.root ?? ".", findTop)
    if ("id" in reach)
      return reach.id === "C22"
        ? { id: "C22", service, repository: reach.repository }
        : { id: "C23", service }
  }
  return undefined
}

/**
 * A path's real path; for one not made yet (zekno's folder before its first
 * use), the real path of the nearest folder above it that is there, and the
 * rest as written.
 */
function realOrNearest(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute
      ? absolute
      : join(realOrNearest(parent), basename(absolute))
  }
}

/**
 * C21b's form for a root (a folder about to be sent) that is, or holds, the
 * person's home folder `home` or zekno's own folder `zeknoHome` (`ZEKNO_HOME`,
 * else `~/.zekno`), compared by real path; undefined for any other. The home
 * folder is said first: it holds zekno's own by default. `folder` is the
 * folder named as given, cleaned. The caller adds the service.
 */
export function rootRefusal(
  root: string,
  home: string,
  zeknoHome: string
): Omit<LineOf<"C21b">, "service"> | undefined {
  const real = realOrNearest(root)
  for (const [given, whose] of [
    [home, "home"],
    [zeknoHome, "zekno"],
  ] as const) {
    const folder = realOrNearest(given)
    if (real === folder)
      return { id: "C21b", folder: sanitize(given), relation: "is", whose }
    if (within(real, folder))
      return { id: "C21b", folder: sanitize(given), relation: "holds", whose }
  }
  return undefined
}
