/** `zekno --help` (contracts/screens.md, `help`): every command, as the program prints it. */
import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { exampleWorld } from "../scene/server"

const recipe: Recipe = {
  title: "The commands",
  command: "zekno --help",
  columns: 100,
  rows: null,
  alt: "zekno --help: one line saying what zekno does, then every command with its flags, one to a line, and how a linked folder and a terminal change what a command needs.",
  async draw() {
    return { lines: await atTerminal(exampleWorld(), ["--help"]), fixed: [] }
  },
}

export default recipe
