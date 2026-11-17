/**
 * What the tests of `zekno add` at a stand-in terminal share
 * (specs/012-templates, tasks T028): folders of design.md's app, a run at
 * the terminal that counts what it contacts, and the board's lines.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { BEFORE_FILE } from "./add-files"
import type { machine } from "./helpers"
import { terminal, type Terminal } from "./terminal"

type Machine = ReturnType<typeof machine>

/** A folder holding `file` as its `zekno.app.json`, none when null. */
export function folder(file: string | null = BEFORE_FILE): string {
  const cwd = tempDir("add-command")
  if (file !== null) writeFileSync(join(cwd, "zekno.app.json"), file)
  return cwd
}

/**
 * Runs `zekno <args>` in `cwd` on `on` at a stand-in terminal `columns`
 * wide, typing with `keys` while it runs. A connection and a fetch are
 * counted, and fail; the stand-in Docker's calls are counted.
 */
export async function atTerminal(
  on: Machine,
  cwd: string,
  args: string[],
  keys: (t: Terminal) => Promise<void> = async () => {},
  options: { columns?: number } = {}
) {
  const t = terminal(options.columns ?? 100, 40)
  const saved = {
    ui: on.deps.ui,
    cwd: on.deps.cwd,
    connect: on.deps.connect,
    fetch: on.deps.fetch,
  }
  let contacted = 0
  const docker = on.docker.calls().length
  Object.assign(on.deps, {
    ui: t.ui,
    cwd,
    connect: () => {
      contacted++
      throw new Error("a server was contacted")
    },
    fetch: async () => {
      contacted++
      throw new Error("the network was used")
    },
  })
  try {
    const running = on.zekno(...args)
    await keys(t)
    const code = await running
    await t.ui.close()
    return {
      code,
      lines: t.lines(),
      contacted,
      docker: on.docker.calls().length - docker,
    }
  } finally {
    Object.assign(on.deps, saved)
  }
}

/** A refusal at a terminal: `✖` and its first sentence, the second under it. */
export const two = (first: string, second: string) => [
  `✖ ${first}`,
  `  ${second}`,
]
