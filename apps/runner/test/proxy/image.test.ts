/**
 * The proxy's image is pinned by digest in one place (contracts/runner.md,
 * "Names the runner uses"): `src/proxy/image.ts`, and nowhere else in the
 * runner's code, tests or scripts. Everything else imports the constant.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { PROXY_IMAGE } from "../../src/proxy/image"

const RUNNER = join(import.meta.dir, "../..")

/** Every file under `dir`, skipping what is built or installed. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name.startsWith("."))
      return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe("the proxy's image", () => {
  test("is Caddy pinned by a sha256 digest, with no tag", () => {
    expect(PROXY_IMAGE).toMatch(/^caddy@sha256:[0-9a-f]{64}$/)
  })

  test("its digest is written in src/proxy/image.ts and in no other file of the runner", () => {
    const digest = PROXY_IMAGE.slice(PROXY_IMAGE.indexOf(":") + 1)
    const naming = ["src", "test", "scripts"]
      .flatMap((part) => filesUnder(join(RUNNER, part)))
      .filter((path) => readFileSync(path, "utf8").includes(digest))
      .map((path) => relative(RUNNER, path))
    expect(naming).toEqual(["src/proxy/image.ts"])
  })
})
