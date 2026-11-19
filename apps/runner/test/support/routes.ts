/**
 * Helpers for the runner's scenarios of routes, the proxy and the health
 * check (specs/015-domains-https, contracts/runner.md, "Tests"): a deploy
 * with routes and a health check sent the way a zekno of this feature sends
 * it, the state and the proxy's file as the runner left them, and the Docker
 * calls in order with their random parts named, so a test can compare them
 * whole.
 */
import type { Health, Route } from "@workspace/core"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { buildDeployV2, deployV2 } from "./deploy-v2"
import { session, type world } from "./helpers"

export type World = Awaited<ReturnType<typeof world>>

/** A route of `service` (default `web`) on `port` (default 3000). */
export const route = (domain: string, service = "web", port = 3000): Route => ({
  domain,
  service,
  port,
})

/** The routes and health check of a deploy of `app`, made against `previous`, sent in a session of its own. */
export async function deployRoutes(
  w: World,
  previous: number,
  input: {
    app?: string
    compose?: string
    routes?: Route[]
    health?: Health | null
    env?: Record<string, string>
  } = {}
) {
  const built = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
    app: input.app ?? "web",
    compose: input.compose,
    routes: input.routes ?? [],
    health: input.health ?? null,
  })
  return deployV2(w, { rosters: w.rosters, ...built }, { env: input.env })
}

/** Sends one request in a session of its own and gives its result. */
export async function ask(
  w: World,
  command: string,
  input?: unknown,
  env: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const s = session(w.home, w.docker.path, env)
  const { result } = await s.request(
    input === undefined ? { command } : { command, input }
  )
  await s.close()
  return result
}

/** The runner's state file, parsed. */
export const stateOf = (home: string) =>
  JSON.parse(readFileSync(join(home, "state.json"), "utf8")) as {
    v: number
    lastSequence: Record<string, number>
    formats: Record<string, number>
    routes: Record<
      string,
      {
        routes: Route[]
        names: Record<string, { container: string; name: string }[]>
      }
    >
  }

/** The proxy's configuration file in the runner's folder, as text, or undefined. */
export function configText(home: string): string | undefined {
  const path = join(home, "proxy", "etc", "caddy.json")
  return existsSync(path) ? readFileSync(path, "utf8") : undefined
}

/** The routes of the proxy's configuration file: each host to its upstreams. */
export function configRoutes(home: string): Record<string, string[]> {
  const text = configText(home)
  if (text === undefined) return {}
  const config = JSON.parse(text) as {
    apps: {
      http: {
        servers: {
          zekno: {
            routes: {
              match?: { host: string[] }[]
              handle: { upstreams?: { dial: string }[] }[]
            }[]
          }
        }
      }
    }
  }
  const routes: Record<string, string[]> = {}
  for (const each of config.apps.http.servers.zekno.routes)
    if (each.match)
      routes[each.match[0]!.host[0]!] = (each.handle[0]!.upstreams ?? []).map(
        (upstream) => upstream.dial
      )
  return routes
}

/**
 * The calls the stand-in Docker got, in order, `up` among them, each with its
 * arguments joined by spaces, and with what changes from run to run named:
 * the runner's folder `<home>`, the pinned image's digest `<digest>`, the
 * server's id `<server>`, each container
 * id given in `ids` by its label, any other container id `<id>`, a name the
 * runner made `<name>`, a nonce `<nonce>` and a time `<time>`.
 */
export function steps(w: World, ids: Record<string, string> = {}): string[] {
  return w.docker.calls().map((call) => {
    // The pinned image's digest is written in src/proxy/image.ts only.
    let text = call.args
      .split(w.home)
      .join("<home>")
      .replace(/caddy@sha256:[0-9a-f]{64}/g, "caddy@sha256:<digest>")
    text = text.split(w.serverId).join("<server>")
    for (const [label, id] of Object.entries(ids))
      text = text.split(id).join(`<${label}>`)
    return text
      .replace(/\b[0-9a-f]{64}\b/g, "<id>")
      .replace(/\bz[0-9a-f]{32}\b/g, "<name>")
      .replace(/\bgen-[0-9a-f]{16}\b/g, "<nonce>")
      .replace(/--since \d+\.\d{3}/g, "--since <time>")
  })
}

/** The `up` call of an app, as `steps` writes it. */
export const up = (app = "web") =>
  `compose -p zekno-${app} -f <home>/apps/${app}/compose.yaml up -d --remove-orphans`

/** The proxy's `docker run`, as `steps` writes it, with the ports it publishes. */
export const proxyRun = (publish = "-p 80:80 -p 443:443") =>
  `run -d --name zekno-proxy --label app.zekno.server=<server> --label app.zekno.role=proxy --restart unless-stopped --network zekno-proxy ${publish} -v zekno-proxy-data:/data -v zekno-proxy-config:/config --mount type=bind,source=<home>/proxy/etc,target=/etc/zekno-proxy,readonly --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges caddy@sha256:<digest> caddy run --config /etc/zekno-proxy/caddy.json`

/** The steps that load a configuration into a running proxy (RN8), after it was joined to its networks. */
export const LOAD = [
  "exec zekno-proxy caddy validate --config /etc/zekno-proxy/caddy.json",
  "logs --since <time> zekno-proxy",
  "exec zekno-proxy kill -USR1 1",
  "logs --since <time> zekno-proxy",
  "exec zekno-proxy grep -q -F -- <nonce> /config/caddy/autosave.json",
]
