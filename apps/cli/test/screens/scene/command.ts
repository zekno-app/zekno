/**
 * A command at the stand-in terminal of test/support/terminal.ts: `zekno
 * <args>` run with the interface a person's terminal gets, keys typed while
 * it runs, and what the terminal shows at the end read back as rows of runs,
 * under the prompt and the command as the walkthroughs drew them.
 */
import { rowsOf, type Row } from "../format"
import { terminal, type Terminal } from "../../support/terminal"
import type { World } from "./server"

/** The first row of a command's screen: the prompt and what was typed, dim. */
export const promptRow = (command: string): Row => [["dim", `$ ${command}`]]

/**
 * Runs `zekno <args>` in `world` at a terminal `columns` wide, with `ssh`
 * meaning the stand-in, typing with `keys` while it runs. Throws when the
 * command ends with another status than `status`. Returns the rows the
 * terminal shows, the prompt first and the empty rows at the end left out.
 */
export async function atTerminal(
  world: World,
  args: string[],
  keys: (t: Terminal) => Promise<void> = async () => {},
  options: { columns?: number; status?: number } = {}
): Promise<Row[]> {
  const columns = options.columns ?? 100
  const t = terminal(columns, 60)
  const saved = world.m.deps.ui
  world.m.deps.ui = t.ui
  try {
    const code = await world.inSsh(async () => {
      const running = world.m.zekno(...args)
      await keys(t)
      return running
    })
    await t.ui.close()
    if (code !== (options.status ?? 0))
      throw new Error(
        `zekno ${args.join(" ")} ended with ${code}:\n${t.screen().join("\n")}`
      )
  } finally {
    world.m.deps.ui = saved
  }
  const rows = rowsOf(t.raw())
  while (rows.length > 0 && rows.at(-1)!.length === 0) rows.pop()
  while (rows.length > 0 && rows[0]!.length === 0) rows.shift()
  return [promptRow(["zekno", ...args].join(" ")), ...rows]
}
