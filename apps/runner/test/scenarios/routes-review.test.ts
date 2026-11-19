/**
 * The findings of the security review of feature 015 for routes and the
 * proxy (specs/015-domains-https, contracts/runner.md, RN6 to RN10; T088),
 * against the real runner program and the stand-in for Docker. Each test
 * failed before its fix.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { world } from "../support/helpers"
import {
  certificatesAlone,
  configRoutes,
  configText,
  deployRoutes,
  LOAD,
  NONCE_SAVED,
  proxyRun,
  route,
  stateOf,
  steps,
  up,
  VALIDATE_ALONE,
  type World,
} from "../support/routes"

const APP = route("app.example.com")
const NEW = route("new.example.com")

/** A world where web holds app.example.com through a running proxy. */
async function routed(): Promise<{ w: World; web: string }> {
  const w = await world()
  const [web] = w.docker.app("web", { web: 1 }).web!
  expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
    "started"
  )
  return { w, web: web! }
}

const notLoaded = (sequence: number) => ({
  outcome: "routes_failed",
  app: "web",
  sequence,
  routes: { failure: "not_loaded" },
})

/** The next file, which is put in place only once Caddy has validated it. */
const nextFile = (w: World) => join(w.home, "proxy", "etc", "caddy.next.json")

describe("S1: what visitors write to the proxy's log", () => {
  test("a signal's answer behind 1.1 MiB of request errors: the nonce in what Caddy saved decides, and the routes are in force", async () => {
    const { w, web } = await routed()
    const before = w.docker.calls().length
    w.docker.script({ flood: Math.ceil(1.1 * 1024 * 1024) })

    const { result } = await deployRoutes(w, 1, { routes: [APP, NEW] })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 2 })
    expect(stateOf(w.home).routes.web!.routes).toEqual([APP, NEW])
    expect(Object.keys(configRoutes(w.home))).toEqual([
      "app.example.com",
      "new.example.com",
    ])
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
    // More than the runner reads of an output: Caddy's answer was past it.
    const log = w.docker.model().logs["zekno-proxy"]!.join("\n")
    expect(log.length).toBeGreaterThan(1024 * 1024)
    expect(steps(w, { web }).slice(before)).toEqual([
      up(),
      "compose -p zekno-web ps -q web",
      "inspect --type container <web>",
      "network inspect zekno-route-web",
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      ...LOAD,
      "inspect --type container zekno-proxy",
    ])
  }, 60_000)

  test("a log that says the load failed ends the wait at once; the nonce is looked for first", async () => {
    const { w } = await routed()
    w.docker.script({ reloads: ["failed"] })
    const before = w.docker.calls().length
    const started = Date.now()
    expect((await deployRoutes(w, 1, { routes: [APP, NEW] })).result).toEqual(
      notLoaded(2)
    )
    expect(Date.now() - started).toBeLessThan(10_000)
    const after = steps(w).slice(before)
    const signal = after.indexOf("exec zekno-proxy kill -USR1 1")
    expect(after.slice(signal + 1, signal + 3)).toEqual([
      NONCE_SAVED,
      "logs --since <time> zekno-proxy",
    ])
  })

  test("the proxy's run caps its log with Docker's local driver, and keeps none of the host's search domains", async () => {
    const { w } = await routed()
    const run = w.docker
      .argv()
      .find((argv) => argv[0] === "run" && argv[1] === "-d")!
    const values = (flag: string) =>
      run.flatMap((word, at) => (word === flag ? [run[at + 1]] : []))
    expect(values("--log-driver")).toEqual(["local"])
    expect(values("--log-opt")).toEqual(["max-size=10m", "max-file=3"])
    expect(values("--dns-search")).toEqual(["."])
    expect(steps(w)).toContain(proxyRun())
  })
})

describe("S7: the configuration is validated before it is in place", () => {
  test("a first start: the next file is validated in a short-lived container with no network, put in place, and only then is the proxy run on it", async () => {
    const { w } = await routed()
    const all = steps(w)
    const validate = all.indexOf(VALIDATE_ALONE)
    expect(validate).toBeGreaterThan(0)
    expect(all[validate + 1]).toBe(proxyRun())
    // Validated before the start, so not again in the proxy once it runs.
    expect(all.filter((step) => step.includes("caddy validate"))).toEqual([
      VALIDATE_ALONE,
    ])
    const run = w.docker
      .argv()
      .find((argv) => argv.includes("validate") && argv[0] === "run")!
    expect(run.slice(0, 8)).toEqual([
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
    ])
    expect(existsSync(nextFile(w))).toBe(false)
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
  })

  test("a first start on a file Caddy refuses: the proxy is never run, no file is in place, nothing is saved", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({ validateFails: 1 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      notLoaded(1)
    )
    expect(steps(w)).toContain(VALIDATE_ALONE)
    expect(steps(w).some((step) => step.startsWith("run -d"))).toBe(false)
    expect(configText(w.home)).toBeUndefined()
    expect(existsSync(nextFile(w))).toBe(false)
    expect(stateOf(w.home).routes).toEqual({})
  })

  test("a running proxy and a file Caddy refuses: caddy.json is exactly as it was, and nothing is signalled or loaded again", async () => {
    const { w } = await routed()
    const earlier = configText(w.home)
    const before = w.docker.calls().length
    w.docker.script({ validateFails: 1 })
    expect((await deployRoutes(w, 1, { routes: [APP, NEW] })).result).toEqual(
      notLoaded(2)
    )
    expect(configText(w.home)).toBe(earlier)
    expect(existsSync(nextFile(w))).toBe(false)
    const after = steps(w).slice(before)
    expect(after.at(-1)).toBe(LOAD[0])
    expect(after.some((step) => step.includes("kill"))).toBe(false)
  })

  test("a stopped proxy is started only once its new file was validated", async () => {
    const { w } = await routed()
    w.docker.change("zekno-proxy", { running: false })
    const before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 1, { routes: [APP, NEW] })).result.outcome
    ).toBe("started")
    const after = steps(w).slice(before)
    expect(after.indexOf(VALIDATE_ALONE)).toBeGreaterThan(0)
    expect(after[after.indexOf(VALIDATE_ALONE) + 2]).toBe("start zekno-proxy")
    expect(Object.keys(configRoutes(w.home))).toEqual([
      "app.example.com",
      "new.example.com",
    ])
  })
})

describe("S2: a released domain's certificate while the proxy does not run", () => {
  test("the proxy stopped, the app's only domain released: deleted through a short-lived container of the pinned image with no network; then the network goes and the proxy is removed", async () => {
    const { w, web } = await routed()
    w.docker.change("zekno-proxy", { running: false })
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { routes: [] })).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(steps(w, { web }).slice(before)).toEqual([
      up(),
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      // RN10, in order: delete, leave, remove the network, remove the proxy.
      "volume inspect zekno-proxy-data",
      certificatesAlone("app.example.com"),
      "network disconnect zekno-route-web zekno-proxy",
      "network inspect zekno-route-web",
      "network disconnect zekno-route-web <web>",
      "network rm zekno-route-web",
      "inspect --type container zekno-proxy",
      "rm -f zekno-proxy",
      "inspect --type container zekno-proxy",
    ])
    // The shell's text is one argument, as it is inside the proxy.
    const deletion = w.docker.argv().find((argv) => argv.includes("sh"))!
    expect(deletion.slice(-3)).toEqual([
      "sh",
      "-c",
      `rm -rf "/data/caddy/certificates/"*"/app.example.com"`,
    ])
  })

  test("the proxy gone: the same deletion, while its volume is there", async () => {
    const { w } = await routed()
    w.docker.change("zekno-proxy", { name: "gone" })
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { routes: [] })).result.outcome).toBe(
      "started"
    )
    const after = steps(w).slice(before)
    expect(after).toContain(certificatesAlone("app.example.com"))
    expect(after.indexOf("volume inspect zekno-proxy-data")).toBeLessThan(
      after.indexOf(certificatesAlone("app.example.com"))
    )
  })

  test("no volume: nothing is run, so Docker makes none by mounting it", async () => {
    const { w } = await routed()
    w.docker.change("zekno-proxy", { running: false })
    w.docker.removeVolume("zekno-proxy-data")
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { routes: [] })).result.outcome).toBe(
      "started"
    )
    const after = steps(w).slice(before)
    expect(after).toContain("volume inspect zekno-proxy-data")
    expect(after.some((step) => step.startsWith("run"))).toBe(false)
    expect(w.docker.model().volumes).not.toContain("zekno-proxy-data")
  })

  test("a proxy of another server's: its volume is not touched", async () => {
    const { w } = await routed()
    w.docker.change("zekno-proxy", {
      labels: { "app.zekno.server": "another", "app.zekno.role": "proxy" },
    })
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { routes: [] })).result.outcome).toBe(
      "started"
    )
    const after = steps(w).slice(before)
    expect(after.some((step) => step.startsWith("volume"))).toBe(false)
    expect(after.some((step) => step.includes("rm -rf"))).toBe(false)
  })
})

describe("S5: OCSP staples", () => {
  test("releasing a.example.co deletes its certificate's folder only: nothing reaches a.example.co-op.example.com's", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    const both = [route("a.example.co"), route("a.example.co-op.example.com")]
    expect((await deployRoutes(w, 0, { routes: both })).result.outcome).toBe(
      "started"
    )
    expect(
      (await deployRoutes(w, 1, { routes: [both[1]!] })).result.outcome
    ).toBe("started")
    const deletions = w.docker.argv().filter((argv) => argv.includes("sh"))
    expect(deletions.map((argv) => argv.at(-1))).toEqual([
      `rm -rf "/data/caddy/certificates/"*"/a.example.co"`,
    ])
    expect(steps(w).join("\n")).not.toContain("/data/caddy/ocsp")
  })
})
