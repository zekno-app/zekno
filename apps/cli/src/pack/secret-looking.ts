/**
 * The secret-looking list (specs/016-build-from-source, contracts/cli.md
 * CL2, "The secret-looking list" and "Entries"; FR-015): files left out of
 * every pack unless `source.include` names them and the person agreed on
 * this machine (CL5, B26). A convenience, not a guarantee; the docs show the
 * list.
 *
 * - By name: `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`,
 *   `.git-credentials`, `.envrc`, `.pypirc`, `.dockercfg`,
 *   `.docker/config.json`, `.aws/credentials`, `.kube/config`, every file in
 *   a `.ssh` folder, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.p12`,
 *   `*.pfx`. The names are matched at any depth, as `.env` is.
 * - By content, in a file of at most 64 KiB: `-----BEGIN` followed by
 *   `PRIVATE KEY-----` on the same line, `-----BEGIN PGP PRIVATE KEY
 *   BLOCK-----`, or a file that starts `PuTTY-User-Key-File-`.
 * - `.git`, or a path under it, named in `source.include`: it holds the
 *   whole history, secrets committed and deleted since among it, and its
 *   `config` often holds a token in a remote's address (CL2).
 *
 * Each match carries its kind, which B7, B8, B26 and C19 choose their forms
 * by: it holds secrets, it is a private key, or it is the repository.
 */
import type { SecretKind } from "../shared/build-lines"
import { readOnce, type Seen } from "./spool"

/** The most of a file read for its content (CL2). */
export const CONTENT_BYTES = 64 * 1024

/** What a secret-looking entry is: it holds secrets, it is a private key, or it is the repository (`.git`). */
export type SecretLookingKind = SecretKind | "git"

/** Names that hold secrets wherever they are. */
const SECRETS = new Set([
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".envrc",
  ".pypirc",
  ".dockercfg",
])

/** Names of a private key wherever they are. */
const KEYS = new Set(["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"])

/** A file of this name directly in a folder of this name holds secrets. */
const IN_FOLDER: readonly (readonly [string, string])[] = [
  [".docker", "config.json"],
  [".aws", "credentials"],
  [".kube", "config"],
]

/** A key store: `*.p12`, `*.pfx`. */
const KEY_STORE = /\.(?:p12|pfx)$/

/**
 * The kind of a path of the folder sent (`/` between its parts) by its name
 * alone, or undefined when its name is not on the list: `git` for `.git` and
 * every path under it, at any depth. `above`: the real path of the folder
 * sent, whose folders count too, so a root that is `.ssh`, `.aws`, `.docker`
 * or `.kube`, or one inside `.git`, sends none of what they hold (CL2): a
 * settings file from someone else may name such a root.
 */
export function secretLookingByName(
  path: string,
  above = ""
): SecretLookingKind | undefined {
  const parts = path.split("/")
  const name = parts.at(-1)!
  const folders = [...above.split("/"), ...parts.slice(0, -1)]
  if (name === ".git" || folders.includes(".git")) return "git"
  if (KEYS.has(name) || KEY_STORE.test(name)) return "private_key"
  if (name === ".env" || name.startsWith(".env.")) return "secrets"
  if (SECRETS.has(name)) return "secrets"
  if (
    IN_FOLDER.some(
      ([folder, file]) => folders.at(-1) === folder && name === file
    )
  )
    return "secrets"
  if (folders.includes(".ssh")) return "secrets"
  return undefined
}

/** `-----BEGIN`, then `PRIVATE KEY-----` on the same line: PEM's private keys, encrypted or not, of any algorithm. */
const PEM_KEY = /-----BEGIN[^\r\n]{0,64}PRIVATE KEY-----/
const PGP_KEY = "-----BEGIN PGP PRIVATE KEY BLOCK-----"
const PUTTY_KEY = "PuTTY-User-Key-File-"

/** Whether a file's bytes look like a private key, by the content forms of CL2. */
export function looksLikePrivateKey(bytes: Uint8Array): boolean {
  // Latin-1 gives one character a byte, so the ASCII markers are found in any file, text or not.
  const text = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.length
  ).toString("latin1")
  return (
    text.startsWith(PUTTY_KEY) || text.includes(PGP_KEY) || PEM_KEY.test(text)
  )
}

/**
 * The kind of a regular file of the folder sent, or undefined when it is not
 * secret-looking: by its name, then, for a file of 1 byte to 64 KiB whose
 * name does not already make it a private key, by its content. `path` is its
 * path on disk, `name` its path in the folder sent, `seen` what pass 1 saw
 * of it: the content is read once, as pass 2 reads (`spool.ts` `readOnce`),
 * so a file that changed is C6 and one that cannot be read C5. `above`: the
 * real path of the folder sent (`secretLookingByName`).
 */
export function secretLookingFile(
  path: string,
  name: string,
  seen: Seen,
  above = ""
): SecretLookingKind | undefined {
  const byName = secretLookingByName(name, above)
  if (byName === "git" || byName === "private_key") return byName
  if (seen.size === 0n || seen.size > BigInt(CONTENT_BYTES)) return byName
  const content = new Uint8Array(Number(seen.size))
  let filled = 0
  readOnce(path, name, seen, (bytes) => {
    content.set(bytes, filled)
    filled += bytes.length
  })
  return looksLikePrivateKey(content) ? "private_key" : byName
}

/**
 * The entry of `source.include` that names a path of the folder sent: the
 * path itself, or a folder above it; undefined when none does. The first
 * entry in the file's order wins.
 */
export function namedIn(
  path: string,
  include: readonly string[]
): string | undefined {
  return include.find((entry) => path === entry || path.startsWith(`${entry}/`))
}
