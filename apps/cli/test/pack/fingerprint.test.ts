/**
 * The same files give the same pack on every machine (specs/016-build-from-
 * source, SC-013; FR-016; data-model.md, "The pack"; quickstart.md,
 * "Fixtures"; tasks T118). The committed fixture `fixtures/fingerprint/`
 * holds nested folders, files of several sizes around a block, one past the
 * 64 KiB read for content, a name of 100 bytes, an executable file and an
 * empty file. Packing it gives the fingerprint recorded here, on macOS and on
 * Linux (compared on GitHub by T166). The fingerprint was checked once
 * against a ustar writer and BLAKE2b written apart from core, from
 * data-model.md's rules.
 *
 * A name the repository's `.gitignore` matches would be in the Mac's working
 * copy and not in a clone, and change the fingerprint between them: the
 * fixture holds none, read with zekno's own ignore rules, never `git`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { packFolder } from "../../src/pack/chunks"
import { matchPath, readIgnoreFile } from "../../src/pack/ignore"
import { dockerFormOf, proposalRules } from "../../src/pack/propose"
import { walkFolder } from "../../src/pack/walk"

const FIXTURE = join(import.meta.dir, "fixtures", "fingerprint")
const REPOSITORY = join(import.meta.dir, "..", "..", "..", "..")

/** SC-013's fingerprint of the fixture: `hash("zekno/v1/pack", tar)`, and the tar's size. */
const FINGERPRINT =
  "f0b0939b9bc6dc642b71692062ce0470541101b9d8be0e35aa7d2216254bfcce"
const SIZE = 88_576

const walk = () =>
  walkFolder(FIXTURE, {
    dockerfile: "Dockerfile",
    ignore: readIgnoreFile(FIXTURE, {
      builder: "dockerfile",
      dockerfile: "Dockerfile",
    }),
    include: [],
    agreed: () => false,
    zeknoHome: join(FIXTURE, "..", "no-zekno-home-here"),
  })

describe("the fingerprint fixture (SC-013)", () => {
  test("holds exactly the entries it was made with: a stray file of this machine would change the fingerprint", () => {
    const found = walk()
    expect(found.leftOut).toEqual([])
    expect(
      found.entries.map((entry) => `${entry.name} ${entry.mode.toString(8)}`)
    ).toEqual([
      "Dockerfile 644",
      "empty.txt 644",
      "names/ 755",
      `names/${"n".repeat(96)}.txt 644`,
      "notes.txt 644",
      "run.sh 755",
      "src/ 755",
      "src/lib/ 755",
      "src/lib/sizes/ 755",
      "src/lib/sizes/block-511.txt 644",
      "src/lib/sizes/block-512.txt 644",
      "src/lib/sizes/block-513.txt 644",
      "src/lib/sizes/large.txt 644",
      "src/main.txt 644",
    ])
    const sizes = new Map(
      found.entries.map((entry) => [entry.name, entry.size])
    )
    expect(sizes.get("empty.txt")).toBe(0)
    expect(sizes.get("src/lib/sizes/large.txt")).toBeGreaterThan(64 * 1024)
  })

  test("packing it gives the recorded fingerprint", async () => {
    const pack = await packFolder(walk(), { seal: null })
    expect(pack).toEqual({ hash: FINGERPRINT, size: SIZE, pieces: [] })
  })

  test("no name in it is one the repository's .gitignore files match", () => {
    const names = walk().entries.map((entry) =>
      entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name
    )
    const fixture = relative(REPOSITORY, FIXTURE)
    // Each .gitignore from the repository's top to the fixture, with the folder it speaks for.
    for (const folder of ["", "apps", "apps/cli", "apps/cli/test"]) {
      let text: string
      try {
        text = readFileSync(join(REPOSITORY, folder, ".gitignore"), "utf8")
      } catch {
        continue
      }
      const lines = text
        .split("\n")
        .map(dockerFormOf)
        .filter((line): line is string => line !== undefined)
      const rules = proposalRules({ lines })
      for (const name of ["", ...names]) {
        const path = relative(folder, join(fixture, name))
        expect({ path, ignored: matchPath(rules, path).excluded }).toEqual({
          path,
          ignored: false,
        })
      }
    }
  })
})
