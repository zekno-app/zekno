/** Paths as a sentence shows them to a person (project.ts). */
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, relative, resolve } from "node:path"

import { sanitize } from "../server/sanitize"

/** A path as a person reads it: under their home folder it starts with `~`. */
export function tilde(path: string, home = homedir()): string {
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** A path for a sentence. A folder's name can hold anything, escape sequences included, so it is cleaned. */
export const shownPath = (path: string): string => sanitize(tilde(path))

/** A Compose file, or a settings file, as the person knows it: from the folder they are in when it is inside it, else from their home. Cleaned: a folder's name can hold anything. */
export function shownFile(cwd: string, path: string): string {
  const folders = [resolve(cwd)]
  try {
    // A file found by its real path is inside the folder's real path.
    folders.push(realpathSync(folders[0]!))
  } catch {
    // A folder that cannot be found again is compared as it was given.
  }
  for (const folder of folders) {
    const inside = relative(folder, path)
    if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside))
      return sanitize(inside)
  }
  return shownPath(path)
}
