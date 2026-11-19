/**
 * The gated set with real Docker and a real proxy (specs/015-domains-https,
 * contracts/runner.md, "Tests"; research R25; T033). It runs the real runner
 * program with real Docker, the pinned image, Caddy's internal authority and
 * the test switch's ports on 127.0.0.1, so it touches no port of this machine
 * but 18080 and 18443 and no certificate authority. The apps are the same
 * pinned image answering with `caddy respond`, named after this process so
 * they cannot clash with anything real.
 *
 * It runs only when Docker answers, the pinned image is on this machine (it
 * never pulls), nothing the runner would make exists already and both ports
 * are free; otherwise it skips and prints one line that says why. It removes
 * everything it made, also when a test fails, and checks that at the end.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { loadConfig } from "../../src/proxy/load"
import { PROXY_IMAGE } from "../../src/proxy/image"
import { world } from "../support/helpers"
import {
  body,
  CHECKED,
  docker,
  everything,
  gate,
  httpGet,
  httpsGet,
  RUNNER_NAMES,
  saved,
  status,
  SWITCH,
  until,
  WEB_A,
  WEB_B,
} from "../support/real-docker"
import {
  ask,
  configText,
  deployRoutes,
  route,
  stateOf,
  type World,
} from "../support/routes"

const skip = gate()
if (skip) console.log(`Skipping the real-proxy tests: ${skip}.`)

const ID = `rp${process.pid}`
const [A, B, C] = [`${ID}a`, `${ID}b`, `${ID}c`]
const DA = `a-${ID}.example.com`
const DB = `b-${ID}.example.com`

let w: World
let ca = ""
const numbers: Record<string, number> = { [A]: 0, [B]: 0, [C]: 0 }
let before: ReturnType<typeof everything>
const savedDocker = process.env.ZEKNO_DOCKER

/** A deploy of `app`, made against its last number, through the runner with real Docker and the switch. */
async function deploy(
  app: string,
  text: string,
  input: Parameters<typeof deployRoutes>[2] = {}
) {
  const answer = await deployRoutes(w, numbers[app]!, {
    app,
    compose: text,
    env: SWITCH,
    ...input,
  })
  if (answer.result.sequence !== undefined)
    numbers[app] = answer.result.sequence as number
  return answer
}

const answered = (domain: string) =>
  until(
    () => httpsGet(domain, ca),
    (answer) => status(answer) === 200
  )

/** Removes everything this set made, whatever state a failed test left. */
function cleanUp() {
  for (const app of [A, B, C])
    docker(
      "compose",
      "-p",
      `zekno-${app}`,
      "down",
      "--remove-orphans",
      "--timeout",
      "1"
    )
  docker("rm", "-f", RUNNER_NAMES.container)
  for (const app of [A, B, C]) docker("network", "rm", `zekno-route-${app}`)
  docker("network", "rm", RUNNER_NAMES.network)
  docker("volume", "rm", ...RUNNER_NAMES.volumes)
}

describe.skipIf(skip !== undefined)("a real proxy (T033)", () => {
  beforeAll(async () => {
    before = everything()
    // The checks this test makes in its own process go to real Docker.
    process.env.ZEKNO_DOCKER = "docker"
    const made = await world()
    w = { ...made, docker: { ...made.docker, path: "docker" } }
  })
  afterAll(() => {
    cleanUp()
    if (savedDocker === undefined) delete process.env.ZEKNO_DOCKER
    else process.env.ZEKNO_DOCKER = savedDocker
  })

  test("a deploy with a domain answers over HTTPS with a certificate for that domain; HTTP is redirected; only 127.0.0.1's test ports", async () => {
    const { result } = await deploy(A, WEB_A, {
      routes: [route(DA, "web", 8080)],
    })
    expect(result).toEqual({ outcome: "started", app: A, sequence: 1 })
    ca = docker(
      "exec",
      "zekno-proxy",
      "cat",
      "/data/caddy/pki/authorities/local/root.crt"
    ).stdout
    expect(ca).toContain("BEGIN CERTIFICATE")

    const answer = await answered(DA)
    expect(answer).toMatchObject({ status: 200, san: `DNS:${DA}` })
    expect("body" in answer && answer.body).toContain("hello from A")
    // A name the proxy has no route for gets no certificate.
    expect(status(await httpsGet(`x-${ID}.example.com`, ca))).toBe(0)

    const redirect = await httpGet(DA)
    expect(redirect).toMatchObject({ status: 308 })
    expect("headers" in redirect && redirect.headers.location).toBe(
      `https://${DA}/`
    )

    expect(
      docker("port", "zekno-proxy").stdout.split("\n").filter(Boolean).sort()
    ).toEqual(["443/tcp -> 127.0.0.1:18443", "80/tcp -> 127.0.0.1:18080"])
    const restart = docker(
      "inspect",
      "--format",
      "{{.HostConfig.RestartPolicy.Name}}",
      "zekno-proxy"
    )
    expect(restart.stdout.trim()).toBe("unless-stopped")

    // S1: its log kept by the local driver, capped; `docker logs` read it to see the proxy start.
    const kept = docker(
      "inspect",
      "--format",
      "{{json .HostConfig.LogConfig}}|{{json .HostConfig.DnsSearch}}",
      "zekno-proxy"
    )
      .stdout.trim()
      .split("|")
      .map((part) => JSON.parse(part) as unknown)
    expect(kept).toEqual([
      { Type: "local", Config: { "max-file": "3", "max-size": "10m" } },
      ["."],
    ])
    // No search domain to complete a name with; Docker's DNS still gave the route's name (the 200 above).
    expect(
      docker("exec", "zekno-proxy", "cat", "/etc/resolv.conf").stdout
    ).not.toMatch(/^search/m)

    // S8: what a visitor forged does not reach the app; X-Forwarded-For is the proxy's own.
    const forged = await httpsGet(DA, ca, {
      "X-Real-Ip": "1.2.3.4",
      Forwarded: "for=1.2.3.4;proto=https",
      "X-Forwarded-For": "6.6.6.6",
    })
    expect(forged).toMatchObject({ status: 200 })
    expect(body(forged)).toContain("xri=[] fwd=[] xff=[")
    expect(body(forged)).not.toContain("1.2.3.4")
    expect(body(forged)).not.toContain("6.6.6.6")
  }, 120_000)

  test("a second app cannot take the domain; with its own, both answer", async () => {
    expect(
      (await deploy(B, WEB_B, { routes: [route(DA, "web", 8080)] })).result
    ).toEqual({
      outcome: "refused",
      reason: "domain_taken",
    })
    expect(
      (await deploy(B, WEB_B, { routes: [route(DB, "web", 8080)] })).result
    ).toEqual({
      outcome: "started",
      app: B,
      sequence: 1,
    })
    const b = await answered(DB)
    expect(b).toMatchObject({ status: 200, san: `DNS:${DB}` })
    expect("body" in b && b.body).toContain("hello from B")
    expect(await answered(DA)).toMatchObject({ status: 200 })
    expect(await ask(w, "status", { routes: true }, SWITCH)).toMatchObject({
      routes: { [A]: [route(DA, "web", 8080)], [B]: [route(DB, "web", 8080)] },
      proxy: "running",
    })
  }, 120_000)

  test("a container restarted behind its name is followed, with no load", async () => {
    const [named] = stateOf(w.home).routes[A]!.names.web!
    const file = configText(w.home)
    expect(docker("restart", "--timeout", "1", named!.container).code).toBe(0)
    const answer = await until(
      () => httpsGet(DA, ca),
      (each) =>
        "body" in each &&
        each.status === 200 &&
        each.body.includes("hello from A"),
      30_000
    )
    expect(answer).toMatchObject({ status: 200 })
    expect(configText(w.home)).toBe(file)
  }, 60_000)

  test("S1: requests the proxy cannot pass on write nothing to its log", async () => {
    const [named] = stateOf(w.home).routes[A]!.names.web!
    expect(docker("stop", "--timeout", "1", named!.container).code).toBe(0)
    for (let i = 0; i < 20; i++)
      expect(await httpsGet(DA, ca)).toMatchObject({ status: 502 })
    const log = docker("logs", "zekno-proxy")
    expect(log.code).toBe(0)
    expect(log.stderr).toContain("serving initial configuration")
    // Caddy's own lines of its http app stay: `http.log` says a server runs.
    for (const logger of ["http.log.error", "http.log.access"])
      expect(`${log.stdout}${log.stderr}`).not.toContain(`"logger":"${logger}"`)
    expect(docker("start", named!.container).code).toBe(0)
    expect(
      await until(
        () => httpsGet(DA, ca),
        (each) => body(each).includes("hello from A"),
        30_000
      )
    ).toMatchObject({ status: 200 })
  }, 90_000)

  test("a broken configuration leaves the earlier one serving; the proxy request puts the state's back", async () => {
    const networks = [`zekno-route-${A}`, `zekno-route-${B}`]
    // Caddy's validate refuses it: nothing is signalled.
    const refused = JSON.stringify({
      admin: { disabled: true },
      apps: {
        http: {
          servers: {
            zekno: {
              "@id": "gen-0000000000000001",
              listen: [":443"],
              routes: [{ handle: [{ handler: "no_such_handler" }] }],
            },
          },
        },
      },
    })
    const inPlace = configText(w.home)!
    const earlier = /"@id": "(gen-[0-9a-f]{16})"/.exec(inPlace)![1]!
    expect(
      await loadConfig(
        w.home,
        { text: refused, nonce: "gen-0000000000000001" },
        networks
      )
    ).toBe("kept")
    // S7: refused before it was in place; the file in place is untouched.
    expect(configText(w.home)).toBe(inPlace)
    expect(existsSync(join(w.home, "proxy", "etc", "caddy.next.json"))).toBe(
      false
    )
    expect(await answered(DA)).toMatchObject({ status: 200 })
    // Validate takes it, the reload refuses it: an address the container does not have.
    const unbindable = JSON.stringify({
      admin: { disabled: true },
      apps: {
        http: {
          servers: {
            zekno: {
              "@id": "gen-0000000000000002",
              listen: ["10.255.255.1:443"],
              routes: [
                { handle: [{ handler: "static_response", status_code: 404 }] },
              ],
            },
          },
        },
      },
    })
    const tried = Date.now()
    expect(
      await loadConfig(
        w.home,
        { text: unbindable, nonce: "gen-0000000000000002" },
        networks
      )
    ).toBe("replaced")
    // S1: the log's failure ended the wait early; the nonce is not in what Caddy saved, the earlier one still is.
    expect(Date.now() - tried).toBeLessThan(10_000)
    const log = docker("logs", "zekno-proxy").stderr
    expect(log).toContain("failed to reload config from file")
    expect(saved("gen-0000000000000002")).toBe(false)
    expect(saved(earlier)).toBe(true)
    expect(await answered(DA)).toMatchObject({ status: 200 })
    expect(await answered(DB)).toMatchObject({ status: 200 })

    // The file in place is not the state's: `proxy` loads the state's again.
    expect(await ask(w, "proxy", undefined, SWITCH)).toEqual({
      proxy: "running",
    })
    const nonce = /"@id": "(gen-[0-9a-f]{16})"/.exec(configText(w.home)!)![1]!
    expect(saved(nonce)).toBe(true)
    expect(await answered(DA)).toMatchObject({ status: 200 })
    // The signal went by exec: the restart policy is still in force.
    expect(
      docker(
        "inspect",
        "--format",
        "{{.HostConfig.RestartPolicy.Name}}",
        "zekno-proxy"
      ).stdout.trim()
    ).toBe("unless-stopped")
  }, 120_000)

  test("a release stops the answer and deletes the certificate's folder; the other app still answers", async () => {
    const folder = `/data/caddy/certificates/local/${DA}`
    expect(docker("exec", "zekno-proxy", "test", "-d", folder).code).toBe(0)
    expect((await deploy(A, WEB_A, { routes: [] })).result).toEqual({
      outcome: "started",
      app: A,
      sequence: 2,
    })
    expect(status(await httpsGet(DA, ca))).toBe(0)
    expect(docker("exec", "zekno-proxy", "test", "-e", folder).code).not.toBe(0)
    expect(docker("network", "inspect", `zekno-route-${A}`).code).not.toBe(0)
    expect(await answered(DB)).toMatchObject({ status: 200 })
  }, 120_000)

  test("the health check passes, fails on 500 and on no answer, and follows no redirect", async () => {
    const check = (svc: string, port = 8080) => ({
      timeout: 4,
      services: [{ service: svc, http: { port, path: "/" } }],
    })
    expect((await deploy(C, CHECKED, { health: check("ok") })).result).toEqual({
      outcome: "started",
      app: C,
      sequence: 1,
    })
    expect((await deploy(C, CHECKED, { health: check("bad") })).result).toEqual(
      {
        outcome: "unhealthy",
        app: C,
        sequence: 2,
        health: { service: "bad", http: true },
      }
    )
    expect(
      (await deploy(C, CHECKED, { health: check("ok", 9999) })).result
    ).toEqual({
      outcome: "unhealthy",
      app: C,
      sequence: 3,
      health: { service: "ok", http: true },
    })
    // Followed, the redirect would reach a name that resolves nowhere.
    expect(
      (await deploy(C, CHECKED, { health: check("moved") })).result
    ).toEqual({
      outcome: "started",
      app: C,
      sequence: 4,
    })
    // Without a path: running with the same restart count for 10 seconds.
    const started = Date.now()
    const steady = await deploy(C, CHECKED, {
      health: { timeout: 30, services: [{ service: "ok", http: null }] },
    })
    expect(steady.result.outcome).toBe("started")
    expect(Date.now() - started).toBeGreaterThanOrEqual(10_000)
    // Nothing was stopped: every service still runs.
    expect(
      docker("compose", "-p", `zekno-${C}`, "ps", "-q")
        .stdout.split("\n")
        .filter(Boolean)
    ).toHaveLength(3)
  }, 180_000)

  test("the last release, with the proxy stopped, deletes the certificate and removes the proxy; its volumes stay until the set removes them", async () => {
    // S2: a short-lived container deletes what the stopped proxy cannot.
    const look = () =>
      docker(
        "run",
        "--rm",
        "--name",
        `zekno-${ID}-look`,
        "--network",
        "none",
        "-v",
        `${RUNNER_NAMES.volumes[0]}:/data:ro`,
        PROXY_IMAGE,
        "test",
        "-e",
        `/data/caddy/certificates/local/${DB}`
      ).code
    expect(look()).toBe(0)
    expect(docker("stop", "--timeout", "1", "zekno-proxy").code).toBe(0)
    expect((await deploy(B, WEB_B, { routes: [] })).result.outcome).toBe(
      "started"
    )
    expect(look()).toBe(1)
    expect(docker("container", "inspect", "zekno-proxy").code).not.toBe(0)
    expect(await ask(w, "status", { routes: true }, SWITCH)).toMatchObject({
      routes: {},
      proxy: "none",
    })
    for (const volume of RUNNER_NAMES.volumes)
      expect(docker("volume", "inspect", volume).code).toBe(0)
  }, 120_000)

  test("everything named zekno-* that the set made is removed", () => {
    cleanUp()
    const after = everything()
    const ours = (name: string) =>
      name === RUNNER_NAMES.network ||
      RUNNER_NAMES.volumes.includes(name) ||
      name.startsWith(`zekno-${ID}`) ||
      name.startsWith(`zekno-route-${ID}`)
    const known = new Set(before.containers.map((c) => c.id))
    // The proxy, the apps, and each health check's container, which removes itself.
    expect(
      after.containers.filter(
        (c) =>
          !known.has(c.id) &&
          (c.name.startsWith("zekno-proxy") ||
            ours(c.name) ||
            c.image === PROXY_IMAGE)
      )
    ).toEqual([])
    expect(after.networks.filter(ours)).toEqual([])
    expect(after.volumes.filter(ours)).toEqual([])
  }, 120_000)
})
