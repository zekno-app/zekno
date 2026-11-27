/**
 * What pass 1 finds of the folder sent, and what it is told
 * (specs/016-build-from-source, contracts/cli.md CL2, "Entries" and "Pass
 * 1"): the entries sent, those left out with their rule (B5), and the
 * secret-looking entries `source.include` names. `pack/walk.ts` makes them,
 * and gives these types on; they live here so the walk stays one subject.
 */
import type { IgnoreRules } from "./ignore"
import type { SecretLookingKind } from "./secret-looking"
import type { Seen } from "./spool"

/** A file to send, with what pass 1 saw of it, which pass 2 compares. */
export type SentFile = {
  /** As packed: `/` between its parts. */
  readonly name: string
  readonly kind: "file"
  readonly mode: 0o644 | 0o755
  readonly size: number
  /** Its path on disk. */
  readonly path: string
  readonly seen: Seen
}

/** A folder to send: its name as packed ends with `/`. */
export type SentFolder = {
  readonly name: string
  readonly kind: "folder"
  readonly mode: 0o755
  readonly size: 0
}

export type SentEntry = SentFile | SentFolder

/** What an entry that is neither a file, a folder nor a link is. */
export type NotAFile = "fifo" | "socket" | "device" | "other"

/**
 * An entry left out, with the rule that left it out (B5), `path` as a
 * person reads it, a folder without its `/`. What is under a folder left
 * out whole is not listed.
 *
 * - `ignore_file`: a pattern of the ignore file in use.
 * - `zekno`: zekno's own folder, or `.git` that `source.include` does not
 *   name (`why`).
 * - `secret_looking`: on the secret-looking list (`kind`); `named` is the
 *   entry of `source.include` that names it, when no one agreed to it here.
 * - `link`: `out` when it leads out of the folder sent.
 * - `not_a_file`: a FIFO, a socket, a device.
 */
export type LeftOut =
  | {
      readonly rule: "ignore_file"
      readonly path: string
      readonly folder: boolean
    }
  | {
      readonly rule: "zekno"
      readonly path: string
      readonly why: "git" | "zekno_home"
    }
  | {
      readonly rule: "secret_looking"
      readonly path: string
      readonly kind: SecretLookingKind
      readonly named: string | null
    }
  | { readonly rule: "link"; readonly path: string; readonly out: boolean }
  | {
      readonly rule: "not_a_file"
      readonly path: string
      readonly kind: NotAFile
    }

/**
 * A secret-looking entry `source.include` names (`named`, the entry of the
 * list): a file by its own path, `.git` or a path under it by the entry, as
 * B26 asks once per file and once per `.git` entry (CL5).
 */
export type NamedSecret = {
  readonly path: string
  readonly kind: SecretLookingKind
  readonly named: string
}

/** What pass 1 found. */
export type Walk = {
  /** The folder sent, a real path. */
  readonly root: string
  /** What is sent, in the order of `compareNames`. */
  readonly entries: readonly SentEntry[]
  /** What is left out, in the walk's order. */
  readonly leftOut: readonly LeftOut[]
  /** Secret-looking entries sent, since `source.include` names them and the person agreed on this machine (B6). */
  readonly secretsSent: readonly NamedSecret[]
  /** Secret-looking entries `source.include` names that no one agreed to on this machine: B26 at a terminal, C19 without one. */
  readonly unagreed: readonly NamedSecret[]
  /** The ignore file in use, as a path in the folder sent, or null. */
  readonly ignoreFile: string | null
  /** `build.dockerfile` as the walk found it, byte for byte, sent as a regular file (C20). */
  readonly dockerfileSent: boolean
  readonly dockerfile: string | null
}

export type WalkOptions = {
  /** `build.dockerfile` as the deploy signs it, always sent; null for a build with no Dockerfile. */
  readonly dockerfile: string | null
  /** The rules of the ignore file in use (`pack/ignore.ts`), whose file is always sent. */
  readonly ignore: IgnoreRules
  /** `source.include`: secret-looking entries to send once agreed. */
  readonly include: readonly string[]
  /**
   * Whether the person agreed on this machine (`agreed.json`, kind `files`)
   * to send a secret-looking entry: a file by its own path, `.git` or a path
   * under it by its entry of `source.include` (CL5).
   */
  readonly agreed: (path: string) => boolean
  /** zekno's own folder: `ZEKNO_HOME`, else `~/.zekno`. Never sent. */
  readonly zeknoHome: string
}
