/**
 * Worlds for the scenarios of the released domains whose certificate is still
 * to delete (specs/015-domains-https, contracts/runner.md, RN3, RN10, RN13;
 * core.md, "The state"): apps that hold domains through a running proxy, with
 * a certificate on its volume for each, and a release whose deletion failed.
 */
import { expect } from "bun:test"
import { join } from "node:path"

import { world } from "./helpers"
import { deployRoutes, route, stateOf, steps, type World } from "./routes"

export const APP = route("app.example.com")
export const API = route("api.example.com", "api", 8080)

export const stateFile = (w: World) => join(w.home, "state.json")

/** The domains with a certificate on the proxy's volume, as the stand-in keeps them. */
export const certificatesOf = (w: World) => w.docker.model().certificates

/** The deletions among `steps`, in order. */
export const deletions = (after: string[]) =>
  after.filter((step) => step.includes("rm -rf"))

/** web holds app.example.com and api holds api.example.com, through a running proxy with a certificate for each. */
export async function twoApps(): Promise<World> {
  const w = await world()
  w.docker.app("web", { web: 1 })
  w.docker.app("api", { api: 1 })
  expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
    "started"
  )
  expect(
    (await deployRoutes(w, 0, { app: "api", routes: [API] })).result.outcome
  ).toBe("started")
  expect(certificatesOf(w)).toEqual(["api.example.com", "app.example.com"])
  return w
}

/** web releases app.example.com and its deletion fails: the domain is on the list, its certificate still on the volume. */
export async function releasedButKept(): Promise<World> {
  const w = await twoApps()
  w.docker.script({ deletionFails: 1 })
  expect((await deployRoutes(w, 1, { routes: [] })).result).toEqual({
    outcome: "started",
    app: "web",
    sequence: 2,
  })
  expect(certificatesOf(w)).toEqual(["api.example.com", "app.example.com"])
  return w
}

/** web alone releases app.example.com while its deletion fails: the proxy is removed, the domain is on the list. */
export async function releasedAlone(): Promise<World> {
  const w = await world()
  w.docker.app("web", { web: 1 })
  expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
    "started"
  )
  w.docker.script({ deletionFails: 1 })
  expect((await deployRoutes(w, 1, { routes: [] })).result.outcome).toBe(
    "started"
  )
  expect(stateOf(w.home).released).toEqual(["app.example.com"])
  expect(
    w.docker.model().containers.some((c) => c.name === "zekno-proxy")
  ).toBe(false)
  expect(certificatesOf(w)).toEqual(["app.example.com"])
  expect(deletions(steps(w))).toHaveLength(1)
  return w
}
