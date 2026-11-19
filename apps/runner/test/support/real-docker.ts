/**
 * Helpers for the gated set that runs a real proxy (specs/015-domains-https,
 * contracts/runner.md, "Tests"; research R25): the gate, Docker run from the
 * test itself, and a request over HTTPS and over plain HTTP to the proxy's
 * ports on 127.0.0.1, read by hand so the test sees the certificate and the
 * redirect exactly as a client gets them.
 */
import { connect as netConnect } from "node:net"
import { connect as tlsConnect } from "node:tls"

import { PROXY_IMAGE } from "../../src/proxy/image"

/** The ports the proxy publishes under the test switch, on 127.0.0.1 only. */
export const HTTP_PORT = 18080
export const HTTPS_PORT = 18443
export const SWITCH = { ZEKNO_PROXY_TEST: `${HTTP_PORT}:${HTTPS_PORT}` }

/** What the runner names, which must not exist before the set and must not after. */
export const RUNNER_NAMES = {
  container: "zekno-proxy",
  network: "zekno-proxy",
  volumes: ["zekno-proxy-data", "zekno-proxy-config"],
}

/** Runs Docker from the test, with a time limit, and gives its status and output. */
export function docker(...args: string[]) {
  const result = Bun.spawnSync(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  })
  return {
    code: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

/** True when nothing listens on `port` of 127.0.0.1. */
function portFree(port: number): boolean {
  try {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

/**
 * Why the set cannot run here, or undefined when it can: Docker answers, the
 * pinned image is on this machine (the set never pulls it), nothing the
 * runner would make exists already, and the two ports are free.
 */
export function gate(): string | undefined {
  if (docker("info").code !== 0) return "Docker does not answer"
  if (docker("image", "inspect", PROXY_IMAGE).code !== 0)
    return "the pinned Caddy image is not on this machine, and the set never pulls it"
  if (docker("container", "inspect", RUNNER_NAMES.container).code === 0)
    return `a container ${RUNNER_NAMES.container} exists already`
  if (docker("network", "inspect", RUNNER_NAMES.network).code === 0)
    return `a network ${RUNNER_NAMES.network} exists already`
  for (const volume of RUNNER_NAMES.volumes)
    if (docker("volume", "inspect", volume).code === 0)
      return `a volume ${volume} exists already`
  for (const port of [HTTP_PORT, HTTPS_PORT])
    if (!portFree(port)) return `port ${port} of 127.0.0.1 is taken`
  return undefined
}

/**
 * Every container (its id, name and image), network and volume Docker has
 * now, to compare before and after. Other programs on this machine may make
 * their own meanwhile, so a test compares only what this set could have made.
 */
export function everything(): {
  containers: { id: string; name: string; image: string }[]
  networks: string[]
  volumes: string[]
} {
  const lines = (text: string) => text.split("\n").filter(Boolean).sort()
  return {
    containers: lines(
      docker("ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}").stdout
    ).map((line) => {
      const [id = "", name = "", image = ""] = line.split("\t")
      return { id, name, image }
    }),
    networks: lines(docker("network", "ls", "--format", "{{.Name}}").stdout),
    volumes: lines(docker("volume", "ls", "--format", "{{.Name}}").stdout),
  }
}

export type Answer =
  | {
      status: number
      headers: Record<string, string>
      body: string
      /** The certificate's names, over HTTPS. */
      san?: string
    }
  | { error: string }

function readAnswer(text: string): Answer {
  const end = text.indexOf("\r\n\r\n")
  const head = (end === -1 ? text : text.slice(0, end)).split("\r\n")
  const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(head[0] ?? "")?.[1])
  if (!Number.isInteger(status))
    return { error: `not HTTP: ${text.slice(0, 80)}` }
  const headers: Record<string, string> = {}
  for (const line of head.slice(1)) {
    const at = line.indexOf(":")
    if (at > 0)
      headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim()
  }
  return { status, headers, body: end === -1 ? "" : text.slice(end + 4) }
}

const request = (domain: string, headers: Record<string, string> = {}) =>
  `GET / HTTP/1.1\r\nHost: ${domain}\r\n${Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("")}Connection: close\r\n\r\n`

/**
 * GET / of `domain` over HTTPS at the proxy's port, with the domain as the
 * server name and `ca` as the only authority trusted: an answer only when the
 * certificate is valid for that domain. `headers` are sent as a visitor
 * would, forged ones among them.
 */
export function httpsGet(
  domain: string,
  ca: string,
  headers: Record<string, string> = {}
): Promise<Answer> {
  return new Promise((resolve) => {
    let text = ""
    let san: string | undefined
    const socket = tlsConnect({
      host: "127.0.0.1",
      port: HTTPS_PORT,
      servername: domain,
      ca,
      ALPNProtocols: ["http/1.1"],
    })
    const done = (answer: Answer) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => done({ error: "timed out" }), 5000)
    socket.on("secureConnect", () => {
      san = socket.getPeerCertificate().subjectaltname
      socket.write(request(domain, headers))
    })
    socket.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")))
    socket.on("end", () => {
      const answer = readAnswer(text)
      done("status" in answer ? { ...answer, san } : answer)
    })
    socket.on("error", (error: Error) => done({ error: error.message }))
  })
}

/** GET / of `domain` over plain HTTP at the proxy's port. */
export function httpGet(domain: string): Promise<Answer> {
  return new Promise((resolve) => {
    let text = ""
    const socket = netConnect({ host: "127.0.0.1", port: HTTP_PORT })
    const done = (answer: Answer) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => done({ error: "timed out" }), 5000)
    socket.on("connect", () => socket.write(request(domain)))
    socket.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")))
    socket.on("end", () => done(readAnswer(text)))
    socket.on("error", (error: Error) => done({ error: error.message }))
  })
}

/** Asks `ask` again every half second until `ok` holds for its answer, for at most `ms`; gives the last answer. */
export async function until<T>(
  ask: () => Promise<T>,
  ok: (answer: T) => boolean,
  ms = 15_000
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const answer = await ask()
    if (ok(answer) || Date.now() > end) return answer
    await Bun.sleep(500)
  }
}

// The apps the set deploys: the pinned image answering with `caddy respond`.

/** A service of the pinned image answering with `caddy respond`. */
const service = (name: string, ...answer: string[]) =>
  `  ${name}:\n    image: ${PROXY_IMAGE}\n    pull_policy: never\n    command: ${JSON.stringify(["caddy", "respond", "--listen", ":8080", ...answer])}\n`
const compose = (...services: string[]) => `services:\n${services.join("")}`
// Caddy fills the placeholders for each request: app A shows what it was sent.
const ECHO =
  "xri=[{http.request.header.X-Real-Ip}] fwd=[{http.request.header.Forwarded}] xff=[{http.request.header.X-Forwarded-For}]"
export const WEB_A = compose(service("web", "--body", `hello from A ${ECHO}`))
export const WEB_B = compose(service("web", "--body", "hello from B"))
export const CHECKED = compose(
  service("ok", "--body", "ok"),
  service("bad", "--status", "500", "--body", "bad"),
  service(
    "moved",
    "--status",
    "302",
    "--header",
    "Location: http://nowhere.invalid/",
    "--body",
    "moved"
  )
)

/** The status of an answer, 0 when there was none. */
export const status = (answer: Answer) =>
  "status" in answer ? answer.status : 0
/** The body of an answer, empty when there was none. */
export const body = (answer: Answer) => ("body" in answer ? answer.body : "")
/** Whether what the proxy's Caddy saved holds `nonce`. */
export const saved = (nonce: string) =>
  docker(
    "exec",
    "zekno-proxy",
    "grep",
    "-q",
    "-F",
    nonce,
    "/config/caddy/autosave.json"
  ).code === 0
