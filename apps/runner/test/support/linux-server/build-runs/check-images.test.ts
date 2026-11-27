/**
 * `check-images.ts` (specs/016-build-from-source, T012 to T014): the base
 * pulled only when absent and removed only when pulled, and the words of an
 * image's identity, with a stand-in function for the stand-in. Nothing here
 * runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  digestIn,
  dropPulled,
  ensureImage,
  identityWords,
  metadataDigests,
  shortDigest,
} from "./check-images"
import type { Answer, RunOptions } from "../host/host-docker"

const BASE =
  "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
const D1 = `sha256:${"1".repeat(64)}`
const D2 = `sha256:${"2".repeat(64)}`

function stand(answers: Record<string, Answer>) {
  const calls: { args: string[]; options?: RunOptions }[] = []
  const run = async (args: readonly string[], options?: RunOptions) => {
    calls.push({ args: [...args], ...(options ? { options } : {}) })
    return (
      answers[args.slice(0, 3).join(" ")] ?? { code: 0, stdout: "", stderr: "" }
    )
  }
  return { run, calls }
}

const ok: Answer = { code: 0, stdout: `${D1}\n`, stderr: "" }
const missing: Answer = {
  code: 1,
  stdout: "",
  stderr: `Error response from daemon: No such image: ${BASE}\n`,
}

describe("the fixtures' base", () => {
  test("already there: not pulled, and never removed", async () => {
    const { run, calls } = stand({ "docker image inspect": ok })
    const present = await ensureImage(run, BASE)
    expect(present).toEqual({ image: BASE, pulled: false })
    expect(calls.map((call) => call.args)).toEqual([
      ["docker", "image", "inspect", "--format", "{{.Id}}", BASE],
    ])
    expect(await dropPulled(run, present)).toEqual([])
    expect(await dropPulled(run, undefined)).toEqual([])
    expect(calls).toHaveLength(1)
  })

  test("absent: pulled by digest with ten minutes, then removed by that name", async () => {
    const { run, calls } = stand({ "docker image inspect": missing })
    const present = await ensureImage(run, BASE)
    expect(present).toEqual({ image: BASE, pulled: true })
    expect(calls[1]).toEqual({
      args: ["docker", "pull", "--quiet", BASE],
      options: { timeoutMs: 600_000 },
    })
    expect(await dropPulled(run, present)).toEqual([])
    expect(calls[2]!.args).toEqual(["docker", "image", "rm", BASE])
  })

  test("a pull that fails throws one line", async () => {
    const { run } = stand({
      "docker image inspect": missing,
      "docker pull --quiet": {
        code: 1,
        stdout: "",
        stderr: "Error response from daemon: toomanyrequests\nmore\n",
      },
    })
    await expect(ensureImage(run, BASE)).rejects.toThrow(
      `docker pull ${BASE} failed: Error response from daemon: toomanyrequests`
    )
  })
})

describe("an image's identity, in words", () => {
  test("a digest is sha256 and 64 hex digits, trimmed; anything else is none", () => {
    expect(digestIn(` ${D1}\n`)).toBe(D1)
    expect(digestIn("sha256:abc")).toBeUndefined()
    expect(digestIn(42)).toBeUndefined()
    expect(digestIn(undefined)).toBeUndefined()
    expect(shortDigest(D1)).toBe("sha256:111111111111…")
  })

  test("the metadata's two digests, each when it is a digest", () => {
    expect(
      metadataDigests({
        "containerimage.digest": D2,
        "containerimage.config.digest": D1,
        "buildx.build.ref": "default/default/x",
      })
    ).toEqual({ digest: D2, config: D1 })
    expect(metadataDigests({ "containerimage.digest": "nope" })).toEqual({})
    expect(metadataDigests(undefined)).toEqual({})
  })

  test("each of the four, and which are equal (map-runner E01: the iidfile is the config digest, .Id the manifest's)", () => {
    expect(identityWords({ iidfile: D1, id: D2, digest: D2, config: D1 })).toBe(
      "the iidfile sha256:111111111111…, .Id sha256:222222222222…, containerimage.digest sha256:222222222222…, containerimage.config.digest sha256:111111111111…; equal: the iidfile = containerimage.config.digest; .Id = containerimage.digest"
    )
    expect(identityWords({ iidfile: D1, id: D1, config: D1 })).toBe(
      "the iidfile sha256:111111111111…, .Id sha256:111111111111…, containerimage.digest absent, containerimage.config.digest sha256:111111111111…; equal: the iidfile = .Id = containerimage.config.digest"
    )
    expect(identityWords({ iidfile: D1, id: D2 })).toBe(
      "the iidfile sha256:111111111111…, .Id sha256:222222222222…, containerimage.digest absent, containerimage.config.digest absent; no two equal"
    )
  })
})
