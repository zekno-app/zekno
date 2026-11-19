/**
 * After `zekno server update`, the runner is sent `proxy` when it holds a
 * route (specs/015-domains-https, contracts/cli.md, CL6; research R21; tasks
 * T065), against this repository's runner with the stand-in Docker: nothing
 * sent for a server with no route; nothing said when the proxy is put right;
 * B16's words for the server when a port is taken.
 */
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { proxyPortTaken } from "../../src/domains/words-extra"
import { proxyAfterUpdate } from "../../src/ops/server-proxy"
import { findServer, profileStore } from "../../src/profile/profile"
import { shopFile } from "../support/domain-folders"
import { ready } from "../support/helpers"
import { wire } from "../support/wire"

/** A ready machine whose folder is shop's settings file with `domains`, and dev's server. */
async function shop(domains: string[]) {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(
    join(m.project, "zekno.app.json"),
    shopFile(domains.length === 0 ? {} : { networking: { domains } })
  )
  m.docker.app("shop", { web: 1, worker: 1 })
  const server = findServer(profileStore(m.home).load(), "dev")
  return { m, server }
}

describe("proxy after an update (CL6)", () => {
  test("a server with no route is not sent proxy", async () => {
    const { m, server } = await shop([])
    expect(await m.zekno("deploy", "--app", "shop", "--server", "dev")).toBe(0)
    const w = wire(m.deps)
    expect(await proxyAfterUpdate(m.deps, server)).toBeUndefined()
    expect(w.requests("status").map((request) => request.input)).toEqual([
      { routes: true },
    ])
    expect(w.requests("proxy")).toEqual([])
  }, 60_000)

  test("a server with a route is sent proxy: nothing said when it works, B16's words for the server when a port is taken", async () => {
    const { m, server } = await shop(["shop.example.com"])
    expect(await m.zekno("deploy", "--app", "shop", "--server", "dev")).toBe(0)
    const w = wire(m.deps)
    expect(await proxyAfterUpdate(m.deps, server)).toBeUndefined()
    expect(w.requests("proxy")).toEqual([{ command: "proxy" }])
    // Another image: the proxy is made again from the pinned one, and by then something holds port 80.
    m.docker.change("zekno-proxy", { image: "caddy:2.10.0" })
    m.docker.script({
      runFails: {
        code: 125,
        stderr: "listen tcp4 0.0.0.0:80: bind: address already in use",
        leave: true,
      },
    })
    expect(await proxyAfterUpdate(m.deps, server)).toBe(
      proxyPortTaken("dev", 80)
    )
  }, 60_000)
})
