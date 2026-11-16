/**
 * The three folders of the security review of app settings, finding S1
 * (specs/010-app-settings/security-review.md): folders where a zekno.json,
 * signed by the team and in use here, decides which file `zekno deploy`
 * signs, while another `zekno.app.json` lies in the folder the command runs
 * in. Each is a ready machine (a team, the local runner `dev`) whose
 * `deps.cwd` is the folder the commands are run in.
 */
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { settingsText } from "../../src/settings/text"
import type { Settings } from "../../src/settings/types"
import { ready } from "./helpers"

/** Settings of one service `web` running `image`, with one plain variable so the Compose text has more than the image. */
export const runs = (image: string): Settings => ({
  version: 1,
  services: [["web", { image, plain: [["FROM", image]] }]],
})

/** The file of `runs(image)`, as zekno writes it. */
export const fileOf = (image: string): string => settingsText(runs(image))

export const ROOT = "ghcr.io/acme/root:1"
export const SUB = "ghcr.io/acme/sub:1"
export const HIDDEN = "ghcr.io/acme/hidden:1"
export const VISIBLE = "ghcr.io/acme/visible:1"

/**
 * A: `zekno.json` at the root names the root's `zekno.app.json` (`ROOT`); a
 * sub-folder `sub` holds its own (`SUB`). The commands run in `sub`; a
 * deploy there signs the root's file.
 */
export async function subFolder() {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "zekno.app.json"), fileOf(ROOT))
  if ((await m.zekno("link", "--app", "demo", "--server", "dev")) !== 0)
    throw new Error(m.lastErr())
  const sub = join(m.project, "sub")
  mkdirSync(sub)
  writeFileSync(join(sub, "zekno.app.json"), fileOf(SUB))
  m.deps.cwd = sub
  return {
    m,
    /** The file a deploy in `sub` signs, as the deploy reads it: by its real path. */
    signedFile: join(realpathSync(m.project), "zekno.app.json"),
    ownFile: join(sub, "zekno.app.json"),
  }
}

/**
 * B: `zekno.json` in the folder names `compose.yaml`, as every folder linked
 * before feature 010 does, and a `zekno.app.json` was added beside it.
 */
export async function linkedCompose() {
  const m = await ready()
  writeFileSync(join(m.project, "zekno.app.json"), fileOf(VISIBLE))
  if (
    (await m.zekno(
      "link",
      "--app",
      "demo",
      "--server",
      "dev",
      "-f",
      "compose.yaml"
    )) !== 0
  )
    throw new Error(m.lastErr())
  return { m, ownFile: join(m.project, "zekno.app.json") }
}

/**
 * C: `zekno.json` names `deploy/zekno.app.json` (`HIDDEN`), and the folder
 * has its own `zekno.app.json` (`VISIBLE`).
 */
export async function linkedElsewhere() {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  mkdirSync(join(m.project, "deploy"))
  writeFileSync(join(m.project, "deploy", "zekno.app.json"), fileOf(HIDDEN))
  if (
    (await m.zekno(
      "link",
      "--app",
      "demo",
      "--server",
      "dev",
      "-f",
      "deploy/zekno.app.json"
    )) !== 0
  )
    throw new Error(m.lastErr())
  writeFileSync(join(m.project, "zekno.app.json"), fileOf(VISIBLE))
  return {
    m,
    signedFile: join(m.project, "deploy", "zekno.app.json"),
    ownFile: join(m.project, "zekno.app.json"),
  }
}
