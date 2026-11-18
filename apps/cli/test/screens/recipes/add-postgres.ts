/**
 * `zekno add postgres` at a terminal (contracts/screens.md, `add-postgres`):
 * in shop's folder, linked to shop on prod-1, whose zekno.app.json has a web
 * service and a worker and no database yet. Asked which services read
 * DATABASE_URL, the person keeps web; asked whether to add it, yes.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { SHOP_BEFORE_DATABASE } from "../scene/files"
import { EXAMPLE, withServer } from "../scene/server"
import { KEYS, shows } from "../../support/terminal"

const recipe: Recipe = {
  title: "Adding a database",
  command: "zekno add postgres",
  columns: 100,
  rows: null,
  alt: "zekno add postgres in shop's folder. web is to read the connection secret. A summary of what it adds to shop on prod-1, in zekno.app.json: the postgres service, pinned by digest, with its data in a volume; a password made on this machine and never shown; and DATABASE_URL built from it for web. A warning that Zekno does not back up this data. After a yes, the service is added to the file and both secrets are stored, sealed for prod-1, to be started by the next deploy.",
  async draw() {
    const world = await withServer(null)
    writeFileSync(join(world.project, "zekno.app.json"), SHOP_BEFORE_DATABASE)
    await world.zekno("link", "--app", EXAMPLE.app, "--server", EXAMPLE.server)
    const lines = await atTerminal(world, ["add", "postgres"], async (t) => {
      await shows(t, "  ❯ ◉ web", 30_000)
      t.keys(KEYS.enter)
      await shows(
        t,
        `? Add postgres to ${EXAMPLE.app}? Nothing is deployed until you deploy. (y/N)`,
        30_000
      )
      t.keys("y")
    })
    return { lines, fixed: [] }
  },
}

export default recipe
