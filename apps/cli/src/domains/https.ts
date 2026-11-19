/**
 * Asking a domain over HTTPS from this machine, as a visitor would
 * (specs/015-domains-https, contracts/cli.md, CL5; research R28; FR-030 to
 * FR-032): a TLS connection to port 443 with the domain as the server name,
 * the certificate judged by the bundled roots (`authorized`) and by an
 * explicit `checkServerIdentity`, and its last day read. No request is sent
 * and no body is read. `fetch` is not used.
 *
 * - `valid`, with the last day: the certificate is good for the domain;
 * - `invalid`: something answered and the handshake did not give such a
 *   certificate (none for that name yet, one of the proxy's own, a TLS
 *   alert);
 * - `none`: nothing answered within 5 seconds, or nothing could be reached.
 *
 * `probeHttps` is one of the three effects: main.ts gives it, and only
 * main.ts. Undefined means "not looked up", with no connection made: no
 * wait, no line.
 *
 * And the wait after a deploy that started with domains new to the app
 * (CL3; B4 to B6): each new domain in domain order, asked every 2 seconds
 * until it answers with a valid certificate or 60 seconds have passed since
 * the wait began; a domain still not answering then is not ready (B6).
 */
import {
  checkServerIdentity,
  connect,
  type ConnectionOptions,
  type PeerCertificate,
} from "node:tls"

/** What HTTPS answered for a domain. */
export type HttpsAnswer =
  { state: "valid"; until: Date } | { state: "invalid" } | { state: "none" }

/** CL5's `probeHttps(domain)`. */
export type ProbeHttps = (domain: string) => Promise<HttpsAnswer>

/** How long a probe waits for an answer (CL5). */
export const PROBE_MS = 5000

/** What the probe uses of a TLS socket, so a test can stand in for `node:tls`. */
export type ProbeSocket = {
  readonly authorized: boolean
  getPeerCertificate(): PeerCertificate | Record<string, never> | null
  once(event: "connect" | "secureConnect", listener: () => void): unknown
  once(event: "error", listener: (error: Error) => void): unknown
  destroy(): unknown
}

export type ProbeOptions = {
  /** Opens the connection; `node:tls`'s by default. */
  connect?: (options: ConnectionOptions) => ProbeSocket
  /** Judges the certificate's names; `node:tls`'s by default. */
  check?: (host: string, cert: PeerCertificate) => Error | undefined
  /** Where to connect instead of the domain and 443: a test's own server on 127.0.0.1. */
  host?: string
  port?: number
  ms?: number
}

/** `probeHttps`, with what it uses given. */
export function probeOf(options: ProbeOptions = {}): ProbeHttps {
  const open = options.connect ?? ((given) => connect(given))
  const check = options.check ?? checkServerIdentity
  const ms = options.ms ?? PROBE_MS
  return (domain) =>
    new Promise<HttpsAnswer>((resolve) => {
      let settled = false
      let reached = false
      let socket: ProbeSocket | undefined
      const finish = (answer: HttpsAnswer) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          socket?.destroy()
        } catch {
          // Gone already.
        }
        resolve(answer)
      }
      // An address where nothing answers sends no event at all (research R28): the probe keeps its own time.
      const timer = setTimeout(() => finish({ state: "none" }), ms)
      try {
        socket = open({
          host: options.host ?? domain,
          port: options.port ?? 443,
          servername: domain,
          rejectUnauthorized: false,
          ALPNProtocols: ["http/1.1"],
        })
      } catch {
        return finish({ state: "none" })
      }
      socket.once("connect", () => {
        reached = true
      })
      socket.once("secureConnect", () => {
        let answer: HttpsAnswer = { state: "invalid" }
        try {
          const cert = socket!.getPeerCertificate()
          const until =
            cert !== null && typeof cert.valid_to === "string"
              ? Date.parse(cert.valid_to)
              : NaN
          if (
            socket!.authorized &&
            cert !== null &&
            Object.keys(cert).length > 0 &&
            check(domain, cert as PeerCertificate) === undefined &&
            Number.isFinite(until)
          )
            answer = { state: "valid", until: new Date(until) }
        } catch {
          answer = { state: "invalid" }
        }
        finish(answer)
      })
      // Refused or not found: nothing answered. Anything after the connection was made: something did, not as it should.
      socket.once("error", () =>
        finish(reached ? { state: "invalid" } : { state: "none" })
      )
    })
}

/** The real probe, through `node:tls`. Only main.ts hands it on. */
export const probeHttps: ProbeHttps = probeOf()

/** How long the wait after a deploy lasts, from when it began, and how often a domain is asked (CL3). */
export const WAIT_MS = 60_000
export const EVERY_MS = 2_000

/** A new domain once the wait is over for it: live until a day, or not ready (B6). */
export type HttpsResult =
  { domain: string; until: Date } | { domain: string; until?: undefined }

/**
 * Waits for each of `domains`, in order, to answer with a valid
 * certificate: `waiting` is told when the wait for a domain begins (B4) and
 * `answered` when it is over (B5, or B6 when it is not ready). Each domain is
 * asked at least once; after that, every `EVERY_MS` while less than
 * `WAIT_MS` has passed since `began`. A probe that throws counts as no
 * answer.
 */
export async function waitForHttps(input: {
  probe: ProbeHttps
  domains: readonly string[]
  began: number
  waiting?: (domain: string, since: number) => void
  answered?: (result: HttpsResult) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<HttpsResult[]> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => Bun.sleep(ms))
  const results: HttpsResult[] = []
  for (const domain of input.domains) {
    input.waiting?.(domain, now())
    let result: HttpsResult = { domain }
    for (;;) {
      const answer = await input
        .probe(domain)
        .catch((): HttpsAnswer => ({ state: "none" }))
      if (answer.state === "valid") {
        result = { domain, until: answer.until }
        break
      }
      const left = WAIT_MS - (now() - input.began)
      if (left <= 0) break
      await sleep(Math.min(EVERY_MS, left))
    }
    results.push(result)
    input.answered?.(result)
  }
  return results
}
