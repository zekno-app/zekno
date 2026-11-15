/**
 * A key store in one file in a test's temporary folder, for the test build
 * only (zekno-test.ts). The app and the single commands a fixture runs are
 * separate processes, so an in-memory store would lose the key between them;
 * the system keychain is never used in a test.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import type { KeyStore } from "../../src/profile/keystore"

function read(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>
}

/** Entries kept as JSON in `path`, readable by this user only, replaced whole on every change. */
export function fileKeyStore(path: string): KeyStore {
  const save = (entries: Record<string, string>) => {
    writeFileSync(`${path}.new`, JSON.stringify(entries), { mode: 0o600 })
    renameSync(`${path}.new`, path)
  }
  return {
    get: async (name) => read(path)[name] ?? null,
    set: async (name, value) => save({ ...read(path), [name]: value }),
    delete: async (name) => {
      const { [name]: _gone, ...rest } = read(path)
      save(rest)
    },
  }
}
