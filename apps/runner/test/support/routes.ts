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
        health: Health | null
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

/**
 * The proxy's `docker run`, as `steps` writes it, with the ports it
 * publishes: its log capped by Docker (security review S1) and no search
 * domain of the host's (review, could not decide 1).
 */
export const proxyRun = (publish = "-p 80:80 -p 443:443") =>
  `run -d --name zekno-proxy --label app.zekno.server=<server> --label app.zekno.role=proxy --restart unless-stopped --log-driver local --log-opt max-size=10m --log-opt max-file=3 --network zekno-proxy --dns-search . ${publish} -v zekno-proxy-data:/data -v zekno-proxy-config:/config --mount type=bind,source=<home>/proxy/etc,target=/etc/zekno-proxy,readonly --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges caddy@sha256:<digest> caddy run --config /etc/zekno-proxy/caddy.json`

/** Caddy's validate of the next file in a short-lived container, before the proxy starts on it (security review S7). */
export const VALIDATE_ALONE =
  "run --rm --network none --cap-drop ALL --security-opt no-new-privileges --mount type=bind,source=<home>/proxy/etc,target=/etc/zekno-proxy,readonly caddy@sha256:<digest> caddy validate --config /etc/zekno-proxy/caddy.next.json"

/** The nonce looked for in what Caddy saved: the one sign that a load worked (security review S1). */
export const NONCE_SAVED =
  "exec zekno-proxy grep -q -F -- <nonce> /config/caddy/autosave.json"

/**
 * The steps that load a configuration into a running proxy (RN8), after it
 * was joined to its networks: the next file validated, the failures already
 * in the log counted, the signal, then the nonce, found at the first look.
 */
export const LOAD = [
  "exec zekno-proxy caddy validate --config /etc/zekno-proxy/caddy.next.json",
  "logs --since <time> zekno-proxy",
  "exec zekno-proxy kill -USR1 1",
  NONCE_SAVED,
]

/** The deletion of a released domain's certificate inside the running proxy (RN10). */
export const certificates = (domain: string) =>
  `exec zekno-proxy sh -c rm -rf "/data/caddy/certificates/"*"/${domain}"`

/** The same deletion through a short-lived container, when the proxy does not run (security review S2). */
export const certificatesAlone = (domain: string) =>
  `run --rm --network none --cap-drop ALL --security-opt no-new-privileges -v zekno-proxy-data:/data caddy@sha256:<digest> sh -c rm -rf "/data/caddy/certificates/"*"/${domain}"`
