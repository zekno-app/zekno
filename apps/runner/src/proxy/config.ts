/**
 * The proxy's configuration (specs/015-domains-https, contracts/runner.md,
 * RN7; research R2), built whole from the routes in force and nothing else:
 * every app's routes, each domain to the names of its service's containers
 * and the route's port. Never pasted: every domain, name and port written
 * into it is checked here against its pattern again, whatever checked it
 * before, and the text is `JSON.stringify` of an object, so no value can be
 * read as more than the one string or number it is (FR-024).
 *
 * The shape, each point verified by running it (research/caddy-on-docker.md):
 * no admin interface; one server listening on :443 only, HTTP/1.1 and
 * HTTP/2, so Caddy answers port 80 with a redirect to HTTPS and opens no UDP
 * socket; a route a domain, and a last route answering 404; certificates from
 * Let's Encrypt only (Caddy's internal authority under the test switch); a
 * grace period of 10 seconds, so one stuck request never keeps a stopping
 * proxy alive; JSON logs on standard error; and a new nonce, which Caddy
 * keeps in what it saves only once a load worked (RN8).
 */
import { randomBytes } from "node:crypto"
import { isRoutableDomain, type AppRoutes } from "@workspace/core"

/** A domain as the domain rule allows it, checked here character by character too. */
const DOMAIN = /^[a-z0-9.-]{1,253}$/
/** A container's name on a route network: made by the runner, never by a deploy (RN5). */
const NAME = /^z[0-9a-f]{32}$/
/** The nonce on the server: `gen-` and 16 hex characters (research R4). */
const NONCE = /^gen-[0-9a-f]{16}$/
/** The nonce as it stands in the text this module writes. */
const NONCE_IN_TEXT = /"@id": "gen-[0-9a-f]{16}"/g

const LETS_ENCRYPT = "https://acme-v02.api.letsencrypt.org/directory"
const LETS_ENCRYPT_STAGING =
  "https://acme-staging-v02.api.letsencrypt.org/directory"

/** A new nonce, from the system's random source. */
export const newNonce = (): string => `gen-${randomBytes(8).toString("hex")}`

function checkedDomain(domain: string): string {
  if (!DOMAIN.test(domain) || !isRoutableDomain(domain))
    throw new Error("A domain in the routes does not match the domain rule.")
  return domain
}

function checkedName(name: string): string {
  if (!NAME.test(name))
    throw new Error("A name in the routes is not one the runner makes.")
  return name
}

function checkedPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("A port in the routes is not a port.")
  return port
}

/** Each route in force, to where its traffic goes, in the order of the domains. */
function routesOf(routes: Readonly<Record<string, AppRoutes>>) {
  const all: { domain: string; dials: string[] }[] = []
  for (const entry of Object.values(routes))
    for (const route of entry.routes) {
      const port = checkedPort(route.port)
      const names = entry.names[route.service] ?? []
      if (names.length === 0)
        throw new Error("A route's service has no container named.")
      all.push({
        domain: checkedDomain(route.domain),
        dials: names.map(({ name }) => `${checkedName(name)}:${port}`),
      })
    }
  return all.sort((a, b) =>
    a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0
  )
}

/**
 * The configuration for these routes in force, as the text to write and the
 * nonce in it. `internal` is the test switch's: Caddy's own authority in
 * place of Let's Encrypt (RN6). Throws when a value does not match its
 * pattern; the caller then loads nothing (`not_loaded`).
 */
export function buildConfig(
  routes: Readonly<Record<string, AppRoutes>>,
  options: { internal: boolean; nonce?: string }
): { text: string; nonce: string } {
  const nonce = options.nonce ?? newNonce()
  if (!NONCE.test(nonce)) throw new Error("A nonce is gen- and 16 hex.")
  const config = {
    admin: { disabled: true },
    logging: {
      logs: {
        default: {
          level: "INFO",
          writer: { output: "stderr" },
          encoder: { format: "json" },
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
            "@id": nonce,
            listen: [":443"],
            protocols: ["h1", "h2"],
            routes: [
              ...routesOf(routes).map(({ domain, dials }) => ({
                match: [{ host: [domain] }],
                handle: [
                  {
                    handler: "reverse_proxy",
                    upstreams: dials.map((dial) => ({ dial })),
                  },
                ],
                terminal: true,
              })),
              // A name the proxy serves with another Host header gets 404, not an empty 200.
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
                options.internal
                  ? { module: "internal" }
                  : // No email: Caddy then asks Let's Encrypt only, and no change of its defaults can bring in another authority.
                    {
                      module: "acme",
                      ca: LETS_ENCRYPT,
                      test_ca: LETS_ENCRYPT_STAGING,
                    },
              ],
            },
          ],
        },
      },
      ...(options.internal
        ? {
            pki: {
              certificate_authorities: { local: { install_trust: false } },
            },
          }
        : {}),
    },
  }
  return { text: `${JSON.stringify(config, null, 2)}\n`, nonce }
}

/**
 * Whether two texts of this module are the same apart from their nonces: a
 * configuration is loaded only when it differs from the file in place, since
 * each load drops a few new connections (RN7; research R6).
 */
export function sameApartFromNonce(a: string, b: string | undefined): boolean {
  if (b === undefined) return false
  const plain = (text: string) => text.replace(NONCE_IN_TEXT, `"@id": ""`)
  return plain(a) === plain(b)
}
