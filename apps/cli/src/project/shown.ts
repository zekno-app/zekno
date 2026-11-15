/** Paths as a sentence shows them to a person (project.ts). */
import { homedir } from "node:os"

import { sanitize } from "../server/sanitize"

/** A path as a person reads it: under their home folder it starts with `~`. */
export function tilde(path: string, home = homedir()): string {
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** A path for a sentence. A folder's name can hold anything, escape sequences included, so it is cleaned. */
export const shownPath = (path: string): string => sanitize(tilde(path))
