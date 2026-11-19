/**
 * The proxy's configuration, built from the routes in force and nothing else
 * (contracts/runner.md, RN7; research R2): the exact JSON, every value
 * checked again, the same state giving the same text apart from the nonce.
 */
import { describe, expect, test } from "bun:test"
import type { AppRoutes } from "@workspace/core"

import { buildConfig, sameApartFromNonce } from "../../src/proxy/config"

const C1 = "a".repeat(64)
const C2 = "b".repeat(64)
const C3 = "c".repeat(64)
const N1 = `z${"1".repeat(32)}`
const N2 = `z${"2".repeat(32)}`
const N3 = `z${"3".repeat(32)}`
const NONCE = "gen-0123456789abcdef"

/** What every configuration holds around its routes (research R2), with Let's Encrypt's issuer. */
function whole(routes: unknown[], issuer: "acme" | "internal" = "acme") {
  return {
    admin: { disabled: true },
    logging: {
      logs: {
        default: {
          level: "INFO",
          writer: { output: "stderr" },
          encoder: { format: "json" },
          exclude: ["http.log.error", "http.log.access"],
        },
      },
    },
    storage: { module: "file_system", root: "/data/caddy" },
    apps: {
      http: {
        http_port: 80,
        https_port: 443,
        grace_period: "10s",
        servers: {
          zekno: {
            "@id": NONCE,
            listen: [":443"],
            protocols: ["h1", "h2"],
            routes: [
              ...routes,
              { handle: [{ handler: "static_response", status_code: 404 }] },
            ],
          },
        },
      },
      tls: {
        automation: {
          policies: [
            {
              issuers: [
                issuer === "acme"
                  ? {
                      module: "acme",
                      ca: "https://acme-v02.api.letsencrypt.org/directory",
                      test_ca:
                        "https://acme-staging-v02.api.letsencrypt.org/directory",
                    }
                  : { module: "internal" },
              ],
            },
          ],
        },
      },
      ...(issuer === "internal"
        ? {
            pki: {
              certificate_authorities: { local: { install_trust: false } },
            },
          }
        : {}),
    },
  }
}

const route = (domain: string, dials: string[]) => ({
  match: [{ host: [domain] }],
  handle: [
    {
      handler: "reverse_proxy",
      headers: { request: { delete: ["X-Real-Ip", "Forwarded"] } },
      upstreams: dials.map((dial) => ({ dial })),
    },
  ],
  terminal: true,
})

const web: AppRoutes = {
  routes: [{ domain: "app.example.com", service: "web", port: 3000 }],
  health: null,
  names: { web: [{ container: C1, name: N1 }] },
}

const build = (routes: Record<string, AppRoutes>, internal = false) =>
  buildConfig(routes, { internal, nonce: NONCE })

describe("the configuration (RN7)", () => {
  test("one route: its domain to the names of its service's containers on its port, then the 404", () => {
    const { text, nonce } = build({ web })
    expect(nonce).toBe(NONCE)
    expect(JSON.parse(text)).toEqual(
      whole([route("app.example.com", [`${N1}:3000`])])
    )
    // The text is JSON.stringify of that object, keys in this order.
    expect(text).toBe(
      `${JSON.stringify(whole([route("app.example.com", [`${N1}:3000`])]), null, 2)}\n`
    )
  })

  test("two apps: every route of every app, in the order of their domains, each copy of a service an upstream", () => {
    const api: AppRoutes = {
      routes: [
        { domain: "api.example.com", service: "api", port: 8080 },
        { domain: "zz.example.org", service: "api", port: 8081 },
      ],
      health: null,
      names: {
        api: [
          { container: C2, name: N2 },
          { container: C3, name: N3 },
        ],
      },
    }
    // A health check with no domain: its names, and the check itself, are not routes.
    const checked: AppRoutes = {
      routes: [],
      health: {
        timeout: 60,
        services: [{ service: "worker", http: { port: 8080, path: "/" } }],
      },
      names: {
        worker: [{ container: "d".repeat(64), name: `z${"4".repeat(32)}` }],
      },
    }
    expect(JSON.parse(build({ web, api, checked }).text)).toEqual(
      whole([
        route("api.example.com", [`${N2}:8080`, `${N3}:8080`]),
        route("app.example.com", [`${N1}:3000`]),
        route("zz.example.org", [`${N2}:8081`, `${N3}:8081`]),
      ])
    )
  })

  test("no route: only the 404; under the test switch, Caddy's internal issuer", () => {
    expect(JSON.parse(build({}).text)).toEqual(whole([]))
    expect(JSON.parse(build({ web }, true).text)).toEqual(
      whole([route("app.example.com", [`${N1}:3000`])], "internal")
    )
  })

  test("a new nonce each time, gen- and 16 hex; the same state gives the same text apart from it", () => {
    const first = buildConfig({ web }, { internal: false })
    const second = buildConfig({ web }, { internal: false })
    expect(first.nonce).toMatch(/^gen-[0-9a-f]{16}$/)
    expect(second.nonce).not.toBe(first.nonce)
    expect(first.text).not.toBe(second.text)
    expect(first.text.replace(first.nonce, NONCE)).toBe(
      second.text.replace(second.nonce, NONCE)
    )
    expect(sameApartFromNonce(first.text, second.text)).toBe(true)
    const other = buildConfig(
      { web: { ...web, names: { web: [{ container: C1, name: N2 }] } } },
      { internal: false }
    )
    expect(sameApartFromNonce(first.text, other.text)).toBe(false)
    expect(sameApartFromNonce(first.text, undefined)).toBe(false)
  })

  test("security review S1: the default log leaves out the request loggers, so no visitor can write to the proxy's log; Caddy's own lines stay", () => {
    const config = JSON.parse(build({ web }).text) as {
      logging: {
        logs: Record<string, { exclude?: string[]; include?: string[] }>
      }
    }
    expect(Object.keys(config.logging.logs)).toEqual(["default"])
    expect(config.logging.logs.default!.exclude).toEqual([
      "http.log.error",
      "http.log.access",
    ])
    // Caddy's core logger, which says a load worked or failed, is not left out.
    expect(config.logging.logs.default!.include).toBeUndefined()
  })

  test("security review S8: each route deletes the request headers a visitor could forge and Caddy does not set itself", () => {
    const config = JSON.parse(build({ web }).text) as {
      apps: {
        http: {
          servers: {
            zekno: { routes: { handle: Record<string, unknown>[] }[] }
          }
        }
      }
    }
    const [proxied, last] = config.apps.http.servers.zekno.routes
    expect(proxied!.handle[0]).toMatchObject({
      handler: "reverse_proxy",
      headers: { request: { delete: ["X-Real-Ip", "Forwarded"] } },
    })
    // X-Forwarded-For, -Proto and -Host are Caddy's own: it replaces what a visitor sent.
    expect(JSON.stringify(proxied)).not.toContain("X-Forwarded")
    expect(last!.handle[0]).toEqual({
      handler: "static_response",
      status_code: 404,
    })
  })

  test("every domain, name and port is checked again here: one that does not match makes the build throw", () => {
    const bad: AppRoutes[] = [
      { ...web, routes: [{ ...web.routes[0]!, domain: 'app.example.com"}' }] },
      { ...web, routes: [{ ...web.routes[0]!, domain: "App.example.com" }] },
      { ...web, routes: [{ ...web.routes[0]!, domain: "localhost" }] },
      { ...web, routes: [{ ...web.routes[0]!, port: 0 }] },
      { ...web, routes: [{ ...web.routes[0]!, port: 70000 }] },
      { ...web, routes: [{ ...web.routes[0]!, port: 3.5 }] },
      { ...web, names: { web: [{ container: C1, name: "z123" }] } },
      { ...web, names: { web: [{ container: C1, name: `${N1}:1` }] } },
      {
        ...web,
        names: { web: [{ container: C1, name: `Z${"1".repeat(32)}` }] },
      },
      // A route whose service has no container named has nowhere to go.
      { ...web, names: {} },
    ]
    for (const entry of bad) expect(() => build({ web: entry })).toThrow()
    expect(() =>
      buildConfig({ web }, { internal: false, nonce: "gen-1" })
    ).toThrow()
  })
})
