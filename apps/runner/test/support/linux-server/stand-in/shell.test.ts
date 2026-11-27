/**
 * How the stand-in's plan writes `sh` (`shell.ts`): a quoted argument reads
 * back unchanged in `sh`, and a script runs as one exact argument list.
 */
import { describe, expect, test } from "bun:test"

import { inContainer, q } from "./shell"

describe("sh", () => {
  test("a quoted argument reads back unchanged", () => {
    for (const text of [
      "plain",
      "it's",
      "a b",
      "$(id) `id` $HOME",
      "'",
      "",
      'x"y\\z',
    ])
      expect(
        Bun.spawnSync(["sh", "-c", `printf '%s' ${q(text)}`]).stdout.toString()
      ).toBe(text)
  })

  test("a script runs in its container as sh -c, stopping at its first failure", () => {
    expect(
      inContainer("zekno-check-a1b2c3d4-server", ["true", "false"])
    ).toEqual([
      "docker",
      "exec",
      "zekno-check-a1b2c3d4-server",
      "sh",
      "-c",
      "set -eu\ntrue\nfalse",
    ])
  })
})
