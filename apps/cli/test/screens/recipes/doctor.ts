/**
 * `zekno doctor` with every check passing (contracts/screens.md, `doctor`):
 * the key, the profile and this folder on this machine, and prod-1 reached
 * over SSH with Docker, the runner and room on its disk, as
 * test/ops/doctor.test.ts sets up "everything in order". The newest release
 * is asked of a stand-in for GitHub that names this runner's own version.
 */
import runnerPackage from "../../../../runner/package.json"
import type { Fetch } from "../../../src/version/newest"
import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { EXAMPLE, SHOP_COMPOSE, withServer } from "../scene/server"

/** The free space the stand-in `df` reports, in KiB: about 133 GB. */
const ROOMY = 129_882_813

/** GitHub as the stand-in answers: the newest release is the one this zekno installs. */
const newest: Fetch = async () => {
  const sha256 = "0123456789abcdef".repeat(4)
  return new Response(
    JSON.stringify({
      version: runnerPackage.version,
      files: { "linux-x64": { sha256 }, "linux-arm64": { sha256 } },
    }),
    { status: 200 }
  )
}

const recipe: Recipe = {
  title: "Every check passing",
  command: "zekno doctor",
  columns: 100,
  rows: null,
  alt: "zekno doctor with every check good. On this machine: zekno and the runner it installs, the key in the system keychain, the profile verified, and this folder linked to shop on prod-1. On prod-1: reached over SSH, Docker with Compose, the runner, and the free space on its disk. Then: no problems, no warnings.",
  async draw() {
    const world = await withServer(SHOP_COMPOSE)
    world.server.df(ROOMY)
    await world.zekno("link", "--app", EXAMPLE.app, "--server", EXAMPLE.server)
    world.m.deps.fetch = newest
    return { lines: await atTerminal(world, ["doctor"]), fixed: [] }
  },
}

export default recipe
