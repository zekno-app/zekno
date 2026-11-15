/**
 * The fixtures every end-to-end test of the app takes: `terminal`, which the
 * engine contributes (engine.ts), and `world`, the test's temporary folders
 * and stand-ins (world.ts), removed when the test ends. A test sets its
 * world up with exact steps (`world.init`, `world.addThisMachine`, ...) and
 * then opens the app on the screen it is about.
 */
import { test as base } from "e2e"

import type { Terminal } from "./engine"
import { createWorld, type World } from "./world"

/** The app's terminal alone, for a test that builds its own world (real-docker.e2e.ts). */
export const terminalTest = base.extend<{ terminal: Terminal }>()
const withTerminal = terminalTest

/** A world with a runner on this machine reachable, and no SSH at all: any SSH destination fails closed. */
export const test = withTerminal.extend<{ world: World }>({
  world: async ({ terminal }, use) => {
    const world = await createWorld()
    try {
      await use(world)
    } finally {
      await terminal.close()
      world.cleanup()
    }
  },
})

/** A world whose SSH reaches only the stand-in server (test/support/stand-in-server.ts). */
export const sshTest = withTerminal.extend<{ world: World }>({
  world: async ({ terminal }, use) => {
    const world = await createWorld({ standInServer: true })
    try {
      await use(world)
    } finally {
      await terminal.close()
      world.cleanup()
    }
  },
})

export { expect, secrets } from "e2e"
