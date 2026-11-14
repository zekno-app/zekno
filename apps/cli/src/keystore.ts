/**
 * Where the signing key lives. In the shipped CLI that is the operating
 * system's keychain and nothing else: there is no option that stores a key
 * in a file. Tests pass an in-memory store instead.
 */
export interface KeyStore {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

export const KEYCHAIN_SERVICE = "app.zekno.cli"

/** Keychain on macOS, libsecret on Linux, Credential Manager on Windows. */
export function osKeychain(): KeyStore {
  return {
    get: (name) => Bun.secrets.get({ service: KEYCHAIN_SERVICE, name }),
    set: (name, value) => Bun.secrets.set({ service: KEYCHAIN_SERVICE, name, value }),
    delete: async (name) => {
      await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name })
    },
  }
}

export function memoryKeyStore(): KeyStore & { size(): number } {
  const entries = new Map<string, string>()
  return {
    get: async (name) => entries.get(name) ?? null,
    set: async (name, value) => void entries.set(name, value),
    delete: async (name) => void entries.delete(name),
    size: () => entries.size,
  }
}
