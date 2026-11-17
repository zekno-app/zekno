/**
 * What the tests of `zekno add`'s operations share (specs/012-templates,
 * tasks T024): a refusal with its class, and, for a ready machine, folders
 * whose keychain reads are counted and whose connection and fetch fail.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { filesUnder, tempDir } from "../../../runner/test/support/helpers"
import type { OpDeps } from "../../src/cli/context"
import { CliError, UsageError, WrongInput } from "../../src/cli/errors"
import type { AddPlan, AddQuestion } from "../../src/ops/add"
import type { machine } from "./helpers"

/** A thrown error, with its class: what `run` prints, and with which status. */
export async function thrown(work: () => unknown): Promise<{
  kind: "CliError" | "WrongInput" | "UsageError"
  message: string
}> {
  try {
    await work()
  } catch (error) {
    const kind =
      error instanceof WrongInput
        ? "WrongInput"
        : error instanceof UsageError
          ? "UsageError"
          : error instanceof CliError
            ? "CliError"
            : undefined
    if (kind === undefined) throw error
    return { kind, message: (error as Error).message }
  }
  throw new Error("nothing was thrown")
}

/** The app and the server, as flags give them. */
export const where = (app: string) => ({ app, server: "dev" })

/** A plan that must be one to write. */
export function plan(prepared: AddPlan | AddQuestion): AddPlan {
  if (!("addition" in prepared))
    throw new Error(`a question: ${JSON.stringify(prepared.ask)}`)
  return prepared
}

/** Helpers on the ready machine `m`. */
export function bench(m: ReturnType<typeof machine>) {
  return {
    /**
     * A folder holding `file` as its `zekno.app.json` (none when undefined),
     * and the team's deps with the folder as `cwd`, the keychain's reads
     * counted, and a connection and a fetch that fail whatever touches them.
     */
    folder(file?: string) {
      const cwd = tempDir("add")
      if (file !== undefined) writeFileSync(join(cwd, "zekno.app.json"), file)
      let reads = 0
      const deps: OpDeps = {
        ...m.deps,
        cwd,
        keyStore: {
          ...m.keyStore,
          get: async (name) => {
            reads++
            return m.keyStore.get(name)
          },
        },
        connect: () => {
          throw new Error("a server was contacted")
        },
        fetch: async () => {
          throw new Error("the network was used")
        },
      }
      return { cwd, deps, reads: () => reads }
    },
    /** Every file of the folder and of the profile, with its bytes and mode. */
    snapshot: (cwd: string) => [...filesUnder(cwd), ...filesUnder(m.home)],
    /** Runs `zekno <args>` on the team's machine; fails the test when it fails. */
    async zekno(...args: string[]) {
      const status = await m.zekno(...args)
      if (status !== 0) throw new Error(m.lastErr())
    },
    /** The app's secret store file on server dev. */
    storePath(app: string): string {
      const profile = JSON.parse(
        readFileSync(join(m.home, "profile.json"), "utf8")
      )
      return join(m.home, "secrets", profile.servers[0].serverId, `${app}.json`)
    },
  }
}
