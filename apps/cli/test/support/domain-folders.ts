/**
 * The setting of the scenarios of feature 015 (specs/015-domains-https,
 * tasks T066): lines.md's example values, shop and its service web on port
 * 3000 on the server prod-1, which this machine reaches over SSH (the
 * stand-in `ssh`), running the runner of this repository with the stand-in
 * Docker, so the runner puts routes in force as it would, and its address
 * comes from the stand-in `sshHost`. A server reached over SSH is what the
 * DNS check needs: a runner on this machine has no public address.
 */
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import runnerPackage from "../../../runner/package.json"
import { machine } from "./helpers"
import {
  realRunner,
  sshStandIn,
  standInServer,
  withSsh,
} from "./stand-in-server"

type Machine = ReturnType<typeof machine>

/** shop's settings file: web on port 3000 with what `web` adds, and a worker. */
export function shopFile(web: Record<string, unknown> = {}): string {
  const { networking, ...rest } = web as {
    networking?: Record<string, unknown>
  }
  return JSON.stringify({
    zekno: 1,
    services: {
      web: {
        source: { image: "ghcr.io/acme/shop-web:1.0.0" },
        networking: { port: 3000, ...networking },
        ...rest,
      },
      worker: { source: { image: "ghcr.io/acme/shop-worker:1.0.0" } },
    },
  })
}

/**
 * A machine with a team and prod-1 connected over the stand-in SSH, its
 * runner already at its path; a folder holding only `file`, linked to shop
 * on prod-1; and Docker holding a running container of each of shop's
 * services, as `up` leaves them. `over` runs work with `ssh` being the
 * stand-in, as every command here must.
 */
export async function shopOnProd(file = shopFile()) {
  const m = machine()
  const server = standInServer()
  server.installed(realRunner(m.docker.path))
  // The release this zekno carries is the runner's own version, so nothing is said about an older or a newer runner.
  m.deps.release = {
    version: runnerPackage.version,
    files: {
      "linux-x64": { sha256: null },
      "linux-arm64": { sha256: null },
    },
  }
  const ssh = sshStandIn(server)
  const over = <T>(work: () => Promise<T>) => withSsh(ssh, work)
  await over(async () => {
    if ((await m.zekno("init", "--name", "Ada")) !== 0)
      throw new Error(m.lastErr())
    if (
      (await m.zekno("server", "add", "prod-1", "--ssh", "deploy@prod-1")) !== 0
    )
      throw new Error(m.lastErr())
  })
  rmSync(join(m.project, "compose.yaml"), { force: true })
  writeFileSync(join(m.project, "zekno.app.json"), file)
  if (
    (await over(() =>
      m.zekno("link", "--app", "shop", "--server", "prod-1")
    )) !== 0
  )
    throw new Error(m.lastErr())
  m.docker.app("shop", { web: 1, worker: 1 })
  m.out.length = 0
  m.err.length = 0
  return {
    m,
    server,
    /** The stand-in `ssh`, to make the server unreachable (`down`). */
    ssh,
    over,
    /** Runs `zekno <args>` over the stand-in SSH, and gives the exit status. */
    zekno: (...args: string[]) => over(() => m.zekno(...args)),
    /** Writes the folder's settings file again. */
    file: (text: string) =>
      writeFileSync(join(m.project, "zekno.app.json"), text),
    /** Forgets what was said so far. */
    clear: () => {
      m.out.length = 0
      m.err.length = 0
    },
  }
}

export type ShopOnProd = Awaited<ReturnType<typeof shopOnProd>>
export type { Machine }
