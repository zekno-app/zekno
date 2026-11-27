/**
 * `pack` (specs/016-build-from-source, T070; contracts/runner.md RB2;
 * core.md CO9, CO12; FR-028, FR-040, FR-069), against the real runner
 * program in a session, and in-process where the free disk is a stand-in
 * figure, as start-limit.test.ts passes its limit. Under the state lock
 * only, in order: the request; the piece's bound; the gate (K4 to K10, with
 * F7); the piece listed by one of the deploy's builds; the cleaning of
 * `packs/`; the free disk of `<home>` less the piece against the floor; the
 * staging past 2 GiB; then the piece staged by its fingerprint and
 * `{ staged }`. Nothing is used up, no secret is opened, no piece is opened
 * and no Docker call is made.
 */
import { describe, expect, test } from "bun:test"
import {
  createSigner,
  generateMemberKeyPair,
  LIMITS,
  parseMessage,
  RunnerPackSchema,
  SESSION_FRAME_BYTES,
} from "@workspace/core"
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { pack } from "../../src/commands/pack"
import { deployV2, signPayload } from "../support/deploy-v2"
import { deployed, session, tempDir, world } from "../support/helpers"
import {
  badlySigned,
  base64Url,
  buildingDeploy,
  deployFile,
  packRequest,
  packsOf,
  packText,
  payloadHashOf,
  stageByHand,
  stagedIn,
} from "../support/pack-staging"

const refused = (reason: string) => ({ outcome: "refused", reason })
/** A lock held by a live process other than the runner's: this test's own. */
const LIVE = `${process.pid}:held`
const stateBytes = (home: string) => readFileSync(join(home, "state.json"))

/** `pack` in this process, its answer read as any answer a session gives. */
const packed = (...args: Parameters<typeof pack>): Promise<unknown> =>
  pack(...args)

/** Every frame the session wrote is one `pack` answer within its 4 KiB bound (CO12, CO19). */
function expectPackFrames(output: string) {
  const lines = output.split("\n").filter(Boolean)
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    expect(Buffer.byteLength(line)).toBeLessThan(SESSION_FRAME_BYTES.pack)
    const { result } = JSON.parse(line) as { result: unknown }
    expect(parseMessage(RunnerPackSchema, result).ok).toBe(true)
  }
}

describe("pack stages a listed piece", () => {
  test("each piece by its fingerprint, mode 600, beside the file naming its deploy; nothing used up and no Docker call", async () => {
    const w = await world()
    const d = await buildingDeploy(w, {
      texts: ["FROM busybox\n", "FROM alpine\n"],
    })
    const before = stateBytes(w.home)
    const s = session(w.home, w.docker.path)
    for (const piece of d.pieces)
      expect(await s.request(packRequest(d.envelope, piece.sealed))).toEqual({
        events: [],
        result: { staged: piece.fingerprint },
      })
    expect((await s.close()).code).toBe(0)
    expectPackFrames(s.output())

    // Both builds' pieces of the one deploy, side by side.
    expect(stagedIn(w.home, "web")).toEqual(
      [...d.pieces.map((piece) => piece.fingerprint), "deploy.json"].sort()
    )
    for (const piece of d.pieces) {
      const path = join(packsOf(w.home, "web"), piece.fingerprint)
      expect(Buffer.compare(readFileSync(path), piece.sealed)).toBe(0)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    expect(deployFile(w.home, "web")).toEqual({
      payload: payloadHashOf(d.envelope),
      previous: 0,
      staged: expect.any(String),
    })
    // No number used, no team list or secret written; Docker never asked.
    expect(stateBytes(w.home)).toEqual(before)
    expect(w.docker.calls()).toEqual([])
  })

  test("nothing is used up: the same envelope stages again, and its deploy is still the app's first", async () => {
    const w = await world()
    const d = await buildingDeploy(w)
    const piece = d.pieces[0]!
    const s = session(w.home, w.docker.path)
    for (let i = 0; i < 2; i++)
      expect(
        (await s.request(packRequest(d.envelope, piece.sealed))).result
      ).toEqual({ staged: piece.fingerprint })
    await s.close()
    expect(stagedIn(w.home, "web")).toEqual(
      [piece.fingerprint, "deploy.json"].sort()
    )

    // The deploy itself is not refused for its order: `pack` used no number.
    // Its build's work folders, if it gets that far, in a folder of the test's own.
    const { result } = await deployV2(
      w,
      { rosters: w.rosters, envelope: d.envelope, records: d.records },
      { env: { ZEKNO_RUNNER_UNPACKED: tempDir("unpacked") } }
    )
    expect(["replayed", "sequence_jump"]).not.toContain(result.reason)
    if ("sequence" in result) expect(result.sequence).toBe(1)
  }, 30_000)

  test("a second deploy's piece replaces the first's", async () => {
    const w = await world()
    const first = await buildingDeploy(w, { texts: ["FROM busybox:1\n"] })
    const second = await buildingDeploy(w, { texts: ["FROM busybox:2\n"] })
    const s = session(w.home, w.docker.path)
    const [one] = first.pieces
    const [two] = second.pieces
    expect(
      (await s.request(packRequest(first.envelope, one!.sealed))).result
    ).toEqual({ staged: one!.fingerprint })
    expect(
      (await s.request(packRequest(second.envelope, two!.sealed))).result
    ).toEqual({ staged: two!.fingerprint })
    await s.close()
    expect(stagedIn(w.home, "web")).toEqual(
      [two!.fingerprint, "deploy.json"].sort()
    )
    expect(deployFile(w.home, "web").payload).toBe(
      payloadHashOf(second.envelope)
    )
  })
})

describe("pack refuses, in its order", () => {
  test("the request, the piece's bound, the gate, then the listing; nothing staged, nothing written", async () => {
    const w = await world()
    const d = await buildingDeploy(w)
    const listed = d.pieces[0]!.sealed
    const before = stateBytes(w.home)
    const outsider = createSigner(generateMemberKeyPair().secretKey)
    const unknown = signPayload(
      d.envelope.payloadType,
      Buffer.from(d.envelope.payload, "base64url"),
      outsider
    )
    const notListed = randomBytes(4096)
    const atBound = randomBytes(LIMITS.sealedPieceBytes)
    const overBound = randomBytes(LIMITS.sealedPieceBytes + 1)
    const piece = base64Url(listed)

    const s = session(w.home, w.docker.path)
    // The request: exactly `{ envelope, piece }`, the piece in base64url's one spelling.
    for (const input of [
      undefined,
      {},
      { envelope: d.envelope },
      { piece },
      { envelope: d.envelope, piece, extra: 1 },
      { envelope: "envelope", piece },
      { envelope: d.envelope, piece: "" },
      { envelope: d.envelope, piece: "ab+/" },
      { envelope: d.envelope, piece: `${piece}=` },
      // One character is no bytes at all; `AB` leaves a bit set past its one byte.
      { envelope: d.envelope, piece: "A" },
      { envelope: d.envelope, piece: "AB" },
    ])
      expect(
        (
          await s.request(
            input === undefined
              ? { command: "pack" }
              : { command: "pack", input }
          )
        ).result
      ).toEqual(refused("invalid_request"))

    // Over the bound once decoded: `pack_mismatch`, before the gate looks at the envelope.
    for (const envelope of [d.envelope, badlySigned(d.envelope), unknown])
      expect(
        (await s.request(packRequest(envelope, overBound))).result
      ).toEqual(refused("pack_mismatch"))

    // The gate before the listing: a piece no deploy lists, with an envelope the gate refuses.
    expect(
      (await s.request(packRequest(badlySigned(d.envelope), notListed))).result
    ).toEqual(refused("bad_signature"))
    expect((await s.request(packRequest(unknown, notListed))).result).toEqual(
      refused("unknown_signer")
    )
    expect(
      (await s.request(packRequest(badlySigned(d.envelope), listed))).result
    ).toEqual(refused("bad_signature"))

    // The listing: a piece of the right deploy that its builds do not list, up to the bound.
    for (const sealed of [notListed, atBound])
      expect((await s.request(packRequest(d.envelope, sealed))).result).toEqual(
        refused("pack_mismatch")
      )
    expect((await s.close()).code).toBe(0)
    expectPackFrames(s.output())

    expect(existsSync(join(w.home, "packs"))).toBe(false)
    expect(stateBytes(w.home)).toEqual(before)
    expect(w.docker.calls()).toEqual([])
  }, 60_000)

  test("the gate: a deploy made against a number the app has passed, or one it has not reached", async () => {
    const w = await deployed(["web"])
    const stale = await buildingDeploy(w, { previous: 0 })
    const ahead = await buildingDeploy(w, { previous: 5 })
    const next = await buildingDeploy(w, { previous: 1 })
    const before = stateBytes(w.home)
    const s = session(w.home, w.docker.path)
    expect(
      (await s.request(packRequest(stale.envelope, stale.pieces[0]!.sealed)))
        .result
    ).toEqual(refused("replayed"))
    expect(
      (await s.request(packRequest(ahead.envelope, ahead.pieces[0]!.sealed)))
        .result
    ).toEqual(refused("sequence_jump"))
    expect(stagedIn(w.home, "web")).toEqual([])
    expect(
      (await s.request(packRequest(next.envelope, next.pieces[0]!.sealed)))
        .result
    ).toEqual({ staged: next.pieces[0]!.fingerprint })
    await s.close()
    expect(deployFile(w.home, "web").previous).toBe(1)
    expect(stateBytes(w.home)).toEqual(before)
  })

  test("packs/ is cleaned once a piece passes the gate and is listed, never before", async () => {
    const w = await world()
    const d = await buildingDeploy(w)
    const now = new Date()
    // A deploy that can no longer run (its app's last number here is 0), one staged 25 hours ago, one that can still run.
    stageByHand(w.home, "old", { previous: 3, staged: now }, 64)
    stageByHand(
      w.home,
      "aged",
      { previous: 0, staged: new Date(now.getTime() - 25 * 3600_000) },
      64
    )
    stageByHand(w.home, "kept", { previous: 0, staged: now }, 64)
    const all = ["aged", "kept", "old"]
    const listedApps = () => readdirSync(join(w.home, "packs")).sort()

    const s = session(w.home, w.docker.path)
    expect(
      (
        await s.request(
          packRequest(badlySigned(d.envelope), d.pieces[0]!.sealed)
        )
      ).result
    ).toEqual(refused("bad_signature"))
    expect(listedApps()).toEqual(all)
    expect(
      (await s.request(packRequest(d.envelope, randomBytes(64)))).result
    ).toEqual(refused("pack_mismatch"))
    expect(listedApps()).toEqual(all)
    expect(
      (await s.request(packRequest(d.envelope, d.pieces[0]!.sealed))).result
    ).toEqual({ staged: d.pieces[0]!.fingerprint })
    await s.close()
    expect(listedApps()).toEqual(["kept", "web"])
  })

  test("staging past 2 GiB with the piece is too_large; at 2 GiB it is staged, and a piece sent again replaces itself", async () => {
    const w = await world()
    const first = await buildingDeploy(w, { texts: ["FROM busybox:1\n"] })
    const second = await buildingDeploy(w, { texts: ["FROM busybox:2\n"] })
    const one = first.pieces[0]!
    const two = second.pieces[0]!
    // The two deploys' pieces have one length, so one replacing the other keeps the total.
    expect(two.sealed.length).toBe(one.sealed.length)
    const other = stageByHand(
      w.home,
      "other",
      { previous: 0, staged: new Date() },
      LIMITS.stagingBytes - one.sealed.length + 1
    )

    const s = session(w.home, w.docker.path)
    expect(
      (await s.request(packRequest(first.envelope, one.sealed))).result
    ).toEqual(refused("too_large"))
    expect(stagedIn(w.home, "web")).toEqual([])
    expect(stagedIn(w.home, "other")).toEqual(["deploy.json", "f".repeat(64)])

    // Exactly at 2 GiB with it: staged.
    truncateSync(other, LIMITS.stagingBytes - one.sealed.length)
    expect(
      (await s.request(packRequest(first.envelope, one.sealed))).result
    ).toEqual({ staged: one.fingerprint })
    // Sent again, it takes its own place, and another deploy's piece takes the place of the first's.
    expect(
      (await s.request(packRequest(first.envelope, one.sealed))).result
    ).toEqual({ staged: one.fingerprint })
    expect(
      (await s.request(packRequest(second.envelope, two.sealed))).result
    ).toEqual({ staged: two.fingerprint })
    await s.close()
    expect(stagedIn(w.home, "web")).toEqual(
      [two.fingerprint, "deploy.json"].sort()
    )
    rmSync(other)
  })
})

describe("pack in-process, with a stand-in free disk", () => {
  /** A filesystem with `free` bytes free to the runner. */
  const statfs = (free: number) => () => ({ bavail: free, bsize: 1 })

  test("free disk of <home> less the piece below the floor is low_disk with disk, after the listing and the cleaning, before too_large", async () => {
    const w = await world()
    const d = await buildingDeploy(w)
    const { sealed, fingerprint } = d.pieces[0]!
    const text = packText(d.envelope, sealed)
    const floor = LIMITS.diskFloorBytes
    const short = floor + sealed.length - 1
    stageByHand(w.home, "old", { previous: 3, staged: new Date() }, 64)

    // One byte short once the piece is written.
    const answer = await packed(w.home, text, { statfs: statfs(short) })
    expect(answer).toEqual({
      outcome: "refused",
      reason: "low_disk",
      disk: { free: short, floor },
    })
    expect(Buffer.byteLength(JSON.stringify({ result: answer }))).toBeLessThan(
      SESSION_FRAME_BYTES.pack
    )
    expect(parseMessage(RunnerPackSchema, answer).ok).toBe(true)
    expect(stagedIn(w.home, "web")).toEqual([])
    // The cleaning came first.
    expect(existsSync(packsOf(w.home, "old"))).toBe(false)

    // A piece the deploy does not list is refused for that, whatever the disk.
    expect(
      await packed(w.home, packText(d.envelope, randomBytes(64)), {
        statfs: statfs(0),
      })
    ).toEqual(refused("pack_mismatch"))

    // A filesystem that cannot be read counts as none free.
    expect(
      await packed(w.home, text, {
        statfs: () => {
          throw new Error("unreadable")
        },
      })
    ).toEqual({
      outcome: "refused",
      reason: "low_disk",
      disk: { free: 0, floor },
    })

    // Low disk before too_large: both hold here.
    const other = stageByHand(
      w.home,
      "other",
      { previous: 0, staged: new Date() },
      LIMITS.stagingBytes
    )
    expect(await packed(w.home, text, { statfs: statfs(short) })).toEqual({
      outcome: "refused",
      reason: "low_disk",
      disk: { free: short, floor },
    })
    expect(await packed(w.home, text, { statfs: statfs(floor * 4) })).toEqual(
      refused("too_large")
    )
    rmSync(other)

    // Exactly at the floor once written: staged.
    expect(
      await packed(w.home, text, { statfs: statfs(floor + sealed.length) })
    ).toEqual({ staged: fingerprint })
    expect(stagedIn(w.home, "web")).toEqual([fingerprint, "deploy.json"].sort())
  })

  test("it waits for the state lock and is busy after the wait; a held deploy lock does not hold it up", async () => {
    const w = await world()
    const d = await buildingDeploy(w)
    const { sealed, fingerprint } = d.pieces[0]!
    const text = packText(d.envelope, sealed)
    const roomy = { statfs: statfs(LIMITS.diskFloorBytes * 4) }

    writeFileSync(join(w.home, "state.lock"), LIVE)
    const started = Date.now()
    expect(await packed(w.home, text, { ...roomy, waitMs: 300 })).toEqual(
      refused("busy")
    )
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    expect(stagedIn(w.home, "web")).toEqual([])
    rmSync(join(w.home, "state.lock"))

    // A deploy holds D: `pack` takes no D, so it stages meanwhile (RB1).
    writeFileSync(join(w.home, "lock"), LIVE)
    expect(await packed(w.home, text, roomy)).toEqual({ staged: fingerprint })
    expect(readFileSync(join(w.home, "lock"), "utf8")).toBe(LIVE)
    expect(existsSync(join(w.home, "state.lock"))).toBe(false)
  })

  test("a runner not set up, or a folder others can read, stages nothing", async () => {
    const w = await world()
    const d = await buildingDeploy(w)
    const text = packText(d.envelope, d.pieces[0]!.sealed)
    expect(await packed(join(w.home, "missing"), text)).toEqual(
      refused("not_set_up")
    )
    chmodSync(join(w.home, "state.json"), 0o644)
    expect(await packed(w.home, text)).toEqual(refused("invalid_state"))
    expect(existsSync(join(w.home, "packs"))).toBe(false)
  })
})
