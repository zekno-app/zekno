/**
 * When a deploy's routes cannot be put in force (specs/015-domains-https,
 * contracts/runner.md, RN3 to RN9, RN12; US1): the app has started, the
 * number is used, the outcome is `routes_failed` with why, and the routes in
 * force stay what they were. Against the real runner program and the
 * stand-in for Docker.
 */
import { describe, expect, test } from "bun:test"

import { world } from "../support/helpers"
import {
  configRoutes,
  configText,
  deployRoutes,
  LOAD,
  route,
  stateOf,
  steps,
  up,
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

const failed = (routes: Record<string, unknown>, sequence = 1) => ({
  outcome: "routes_failed",
  app: "web",
  sequence,
  routes,
})

describe("port_taken (RN6)", () => {
  test("another container holds 443: the container left in Created is removed, the port named, nothing saved", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({
      runFails: {
        code: 125,
        stderr:
          "docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint zekno-proxy (43b6): Bind for 0.0.0.0:443 failed: port is already allocated\n",
        leave: true,
      },
    })
    const { result } = await deployRoutes(w, 0, { routes: [APP] })
    expect(result).toEqual(failed({ failure: "port_taken", port: 443 }))
    const after = steps(w)
    const run = after.findIndex((step) => step.startsWith("run -d"))
    expect(after.slice(run + 1)).toEqual([
      "inspect --type container zekno-proxy",
      "rm -f zekno-proxy",
      "inspect --type container zekno-proxy",
    ])
    expect(w.docker.model().containers.map((c) => c.name)).toEqual([
      "zekno-web-web-1",
    ])
    const state = stateOf(w.home)
    expect(state.routes).toEqual({})
    // The number is used: the app started.
    expect(state.lastSequence).toEqual({ web: 1 })
  })

  test("a program holds 80: address already in use names port 80", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({
      runFails: {
        code: 125,
        stderr:
          "docker: Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:80 -> 127.0.0.1:0: listen tcp4 0.0.0.0:80: bind: address already in use\n",
        leave: false,
      },
    })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "port_taken", port: 80 })
    )
    expect(stateOf(w.home).routes).toEqual({})
  })

  test("any other failure of the run is not_loaded", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({
      runFails: { code: 125, stderr: "no space left on device\n", leave: true },
    })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "not_loaded" })
    )
    expect(w.docker.model().containers.map((c) => c.name)).toEqual([
      "zekno-web-web-1",
    ])
  })
})

describe("no_container and host_network (RN4, RN5)", () => {
  test("a routed service with no container: no_container with the service, no network made, nothing saved", async () => {
    const w = await world()
    w.docker.app("web", { worker: 1 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "no_container", service: "web" })
    )
    expect(steps(w)).toEqual([up(), "compose -p zekno-web ps -q web"])
    expect(stateOf(w.home).routes).toEqual({})
  })

  test("a container that is not the app's, or a one-off, does not count", async () => {
    const w = await world()
    w.docker.app("web", {
      web: [
        {
          labels: {
            "com.docker.compose.project": "zekno-other",
            "com.docker.compose.service": "web",
          },
        },
        {
          labels: {
            "com.docker.compose.project": "zekno-web",
            "com.docker.compose.service": "web",
            "com.docker.compose.oneoff": "True",
          },
        },
      ],
    })
    // compose ps -q lists by project and service; the labels are read again, and these fail them.
    w.docker.change("zekno-web-web-1", {
      labels: {
        "com.docker.compose.project": "zekno-web",
        "com.docker.compose.service": "web",
        "com.docker.compose.oneoff": "True",
      },
    })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "no_container", service: "web" })
    )
  })

  test("more than 16 containers of a service is no_container", async () => {
    const w = await world()
    w.docker.app("web", { web: 17 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "no_container", service: "web" })
    )
  })

  test("a container on the host's network: host_network with the service", async () => {
    const w = await world()
    w.docker.app("web", { web: [{ networkMode: "host" }] })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "host_network", service: "web" })
    )
    expect(stateOf(w.home).routes).toEqual({})
  })

  test("a name Docker will not show, twice: no_container", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({ connectWithoutAlias: 2 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "no_container", service: "web" })
    )
    // Once, then once more: the container taken off and joined again with a new name.
    const tries = steps(w).filter((step) => step.startsWith("network "))
    expect(tries).toEqual([
      "network inspect zekno-route-web",
      "network create --label app.zekno.server=<server> --label app.zekno.app=web zekno-route-web",
      "network connect --alias <name> zekno-route-web <id>",
      "network disconnect zekno-route-web <id>",
      "network connect --alias <name> zekno-route-web <id>",
    ])
  })

  test("a name Docker shows the second time is used", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({ connectWithoutAlias: 1 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
  })
})

describe("not_loaded (RN5 to RN9)", () => {
  test("the proxy refuses the file: the state is unchanged and the earlier configuration is loaded again", async () => {
    const { w } = await routed()
    const state = stateOf(w.home)
    const earlier = configRoutes(w.home)
    const before = w.docker.calls().length
    w.docker.script({ reloads: ["failed"] })

    expect((await deployRoutes(w, 1, { routes: [APP, NEW] })).result).toEqual(
      failed({ failure: "not_loaded" }, 2)
    )
    const after = steps(w).slice(before)
    // The new file tried until the log said no, then the state's loaded again by the same steps.
    expect(after.slice(-(LOAD.length * 2 + 3))).toEqual([
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      ...LOAD.slice(0, -1),
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      ...LOAD,
    ])
    expect(stateOf(w.home).routes).toEqual(state.routes)
    expect(stateOf(w.home).lastSequence).toEqual({ web: 2 })
    expect(configRoutes(w.home)).toEqual(earlier)
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
    // Nothing released: no certificate deleted, no network left.
    expect(after.some((step) => step.includes("rm -rf"))).toBe(false)
    expect(after.some((step) => step.startsWith("network disconnect"))).toBe(
      false
    )
  })

  test("validate fails, or the log says loaded with no nonce saved: each not_loaded, the state unchanged", async () => {
    for (const script of [
      { validateFails: 1 },
      { reloads: ["no_autosave" as const] },
    ]) {
      const { w } = await routed()
      const state = stateOf(w.home)
      w.docker.script(script)
      expect((await deployRoutes(w, 1, { routes: [APP, NEW] })).result).toEqual(
        failed({ failure: "not_loaded" }, 2)
      )
      expect(stateOf(w.home).routes).toEqual(state.routes)
      expect(configRoutes(w.home)).toEqual({
        "app.example.com": [`${state.routes.web!.names.web![0]!.name}:3000`],
      })
    }
  })

  test("a load the log does not answer within 15 seconds is not_loaded", async () => {
    const { w } = await routed()
    const state = stateOf(w.home)
    w.docker.script({ reloads: ["silent"] })
    const started = Date.now()
    expect((await deployRoutes(w, 1, { routes: [APP, NEW] })).result).toEqual(
      failed({ failure: "not_loaded" }, 2)
    )
    expect(Date.now() - started).toBeGreaterThanOrEqual(15_000)
    expect(stateOf(w.home).routes).toEqual(state.routes)
  }, 40_000)

  test("a proxy labelled for another server: not_loaded, and it is never touched", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.container({
      name: "zekno-proxy",
      image: "caddy:2",
      labels: { "app.zekno.server": "someone-else", "app.zekno.role": "proxy" },
    })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "not_loaded" })
    )
    const touched = steps(w).filter(
      (step) => step.includes("zekno-proxy") && !step.startsWith("inspect")
    )
    expect(touched).toEqual([])
    expect(configText(w.home)).toBeUndefined()
    expect(stateOf(w.home).routes).toEqual({})
  })

  test("a route network the runner did not make is not used", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.network("zekno-route-web", { "app.zekno.app": "web" })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual(
      failed({ failure: "not_loaded" })
    )
    expect(steps(w).some((step) => step.startsWith("network connect"))).toBe(
      false
    )
  })

  test("a test switch set wrong starts no proxy at all", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    const values = ["80:443", "18080", "18080:18080", "x:y"]
    for (const [previous, value] of values.entries()) {
      const { result } = await deployRoutes(w, previous, {
        routes: [APP],
        env: { ZEKNO_PROXY_TEST: value },
      })
      expect(result).toEqual(failed({ failure: "not_loaded" }, previous + 1))
    }
    expect(steps(w).some((step) => step.startsWith("run"))).toBe(false)
  })
})

describe("up failed (RN3)", () => {
  test("start_failed as today, and a domain this deploy releases is still released; no health wait", async () => {
    const { w } = await routed()
    w.docker.failWith(1)
    const { result, events } = await deployRoutes(w, 1, {
      routes: [],
      health: {
        timeout: 1,
        services: [{ service: "web", http: { port: 3000, path: "/" } }],
      },
    })
    expect(result).toEqual({ outcome: "start_failed", app: "web", sequence: 2 })
    expect(events.filter((e) => e.event === "health")).toEqual([])
    // The health check keeps the app's network and names; the route is gone, and with it the proxy.
    const state = stateOf(w.home)
    expect(state.routes.web!.routes).toEqual([])
    expect(configRoutes(w.home)).toEqual({})
    expect(steps(w).at(-2)).toBe("rm -f zekno-proxy")
    expect(steps(w).some((step) => step.startsWith("run --rm"))).toBe(false)
  })

  test("start_failed is reported over routes_failed", async () => {
    const w = await world()
    w.docker.failWith(1)
    expect((await deployRoutes(w, 0, { routes: [APP] })).result).toEqual({
      outcome: "start_failed",
      app: "web",
      sequence: 1,
    })
  })
})
