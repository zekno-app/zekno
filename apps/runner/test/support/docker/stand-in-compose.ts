/**
 * The stand-in's check before `compose … up --no-build` goes on as `up`
 * always has (specs/016-build-from-source, T064; contracts/runner.md RB13;
 * E08): the stand-in's shell runs this with its folder, the call's folder
 * and Docker's arguments. It reads the Compose file named by `-f` and exits
 * 1 with "No such image", as Compose does, when a service's built image
 * (`zekno.invalid/…`) is not in the model; else 0 and the shell goes on. It
 * writes nothing: the call is recorded by the shell, as every `up` is.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { readModel } from "./model"
import { composeRefusal } from "./stand-in-buildx-records"

const [dir, cwd, ...args] = process.argv.slice(2) as [
  string,
  string,
  ...string[],
]
const files = args.flatMap((word, i) =>
  args[i - 1] === "-f" || args[i - 1] === "--file" ? [resolve(cwd, word)] : []
)
let text = ""
for (const file of files) {
  try {
    text += `${readFileSync(file, "utf8")}\n`
  } catch {
    // A file Compose cannot read fails Compose on its own; nothing to check here.
  }
}
const refused = composeRefusal(readModel(dir), text)
if (refused) process.stderr.write(refused)
process.exit(refused ? 1 : 0)
