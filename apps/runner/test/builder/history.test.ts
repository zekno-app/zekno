/**
 * Docker's own record of a build (specs/016-build-from-source, T077;
 * contracts/runner.md RB12; FR-031b): the ref file buildx leaves in the
 * runner's private `BUILDX_CONFIG` names the build, whenever it shows; the
 * record's state; its removal, the ref file kept when the removal fails,
 * and nothing removed that has no ref file here. Docker is a stand-in
 * script that records its calls; a build client is a promise the test ends.
 * Whether the record's bytes leave Docker's storage is check L10's, on
 * real Docker.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  leftRefs,
  newRef,
  recordState,
  refFile,
  refsNow,
  removeRecord,
  type BuildRef,
} from "../../src/builder/history"
import { tempDir } from "../support/helpers"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

/**
 * A stand-in Docker for `buildx history inspect` and `rm`: each call's
 * arguments and folder are logged; what it prints and its status are files
 * the test writes beside it (`inspect.out`, `inspect.code`, `rm.code`,
 * `hang`).
 */
function standIn() {
  const dir = tempDir("history-docker")
  const path = join(dir, "docker")
  writeFileSync(
    path,
    `#!/bin/sh
here="${dir}"
printf '%s | %s\\n' "$*" "$(pwd -P)" >> "$here/calls.log"
case "$3" in
  inspect)
    [ -f "$here/hang" ] && exec sleep 30
    [ -f "$here/inspect.out" ] && cat "$here/inspect.out"
    exit "$(cat "$here/inspect.code" 2> /dev/null || echo 0)" ;;
  rm)
    exit "$(cat "$here/rm.code" 2> /dev/null || echo 0)" ;;
esac
exit 1
`
  )
  chmodSync(path, 0o755)
  process.env.ZEKNO_DOCKER = path
  return {
    script: (name: string, content: string) =>
      writeFileSync(join(dir, name), content),
    calls: () =>
      existsSync(join(dir, "calls.log"))
        ? readFileSync(join(dir, "calls.log"), "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [],
  }
}

/** A runner's home with buildx's private folder, as T062 makes it. */
function home(): string {
  const dir = tempDir("history-home")
  mkdirSync(join(dir, "buildx"), { recursive: true, mode: 0o700 })
  return realpathSync(dir)
}

/** A ref file as buildx writes it: paths, never code. */
function writeRef(
  dir: string,
  id: string,
  builder = "default",
  node = builder
) {
  const folder = join(dir, "buildx", "refs", builder, node)
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, id),
    JSON.stringify({
      Target: "default",
      LocalPath: "-",
      DockerfilePath: "Dockerfile",
    })
  )
}

const ID = "kcf12h1o0p8v2vw7ly89cnofl"
const OTHER = "pkx6c0z6mr7mq4vytvvtwqvlk"

/** A build client the test ends. */
function client() {
  let end!: () => void
  const ended = new Promise<void>((resolve) => {
    end = resolve
  })
  return { ended, end }
}

describe("refsNow and leftRefs", () => {
  test("list every ref file under buildx/refs/<builder>/<node>/, and nothing else there", () => {
    const dir = home()
    expect(refsNow(dir)).toEqual([])
    writeRef(dir, ID)
    writeRef(dir, OTHER, "desktop-linux")
    // Not a record's name, not a file, or a link: never listed, so never removed.
    writeRef(dir, "-rf")
    writeRef(dir, ".hidden")
    mkdirSync(join(dir, "buildx", "refs", "default", "default", "folder0"))
    symlinkSync(
      "/etc/hosts",
      join(dir, "buildx", "refs", "default", "default", "linked0")
    )
    writeFileSync(join(dir, "buildx", "refs", "default", "stray0"), "")
    const refs: BuildRef[] = [
      { home: dir, builder: "default", node: "default", id: ID },
      { home: dir, builder: "desktop-linux", node: "desktop-linux", id: OTHER },
    ]
    expect(refsNow(dir)).toEqual(refs)
    expect(leftRefs(dir)).toEqual(refs)
    expect(refFile(refs[0]!)).toBe(
      join(dir, "buildx", "refs", "default", "default", ID)
    )
  })

  test("a home with no buildx folder has no refs", () => {
    expect(refsNow(tempDir("history-none"))).toEqual([])
  })
})

describe("newRef", () => {
  test("finds the ref that shows at the start", async () => {
    const dir = home()
    writeRef(dir, OTHER)
    const before = refsNow(dir)
    const run = client()
    writeRef(dir, ID)
    const found = await newRef(dir, before, run.ended, { everyMs: 20 })
    expect(found?.id).toBe(ID)
  })

  test("finds the ref that shows after the first vertex, while the client runs", async () => {
    const dir = home()
    writeRef(dir, OTHER)
    const before = refsNow(dir)
    const run = client()
    setTimeout(() => writeRef(dir, ID), 120)
    const started = Date.now()
    const found = await newRef(dir, before, run.ended, { everyMs: 20 })
    expect(found?.id).toBe(ID)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    run.end()
  })

  test("reads once more after the client ends", async () => {
    const dir = home()
    const run = client()
    setTimeout(() => {
      writeRef(dir, ID)
      run.end()
    }, 50)
    // The folder would next be read long after the client ended.
    const found = await newRef(dir, [], run.ended, { everyMs: 60_000 })
    expect(found?.id).toBe(ID)
  })

  test("gives none when the client ends without one, and never an older ref", async () => {
    const dir = home()
    writeRef(dir, OTHER)
    const before = refsNow(dir)
    const run = client()
    setTimeout(run.end, 50)
    expect(
      await newRef(dir, before, run.ended, { everyMs: 20 })
    ).toBeUndefined()
  })

  test("a client that fails to start ends the search too", async () => {
    const dir = home()
    expect(
      await newRef(dir, [], Promise.reject(new Error("no client")), {
        everyMs: 20,
      })
    ).toBeUndefined()
  })
})

describe("recordState", () => {
  const ref = (dir: string): BuildRef => ({
    home: dir,
    builder: "default",
    node: "default",
    id: ID,
  })

  test("asks `history inspect` for the ref by its builder, in the runner's folder", async () => {
    const docker = standIn()
    const dir = home()
    docker.script(
      "inspect.out",
      "Duration: 1m 30s\nBuild Steps: 6/6 (17% cached)\n"
    )
    expect(await recordState(ref(dir), 1000)).toBe("ended")
    expect(docker.calls()).toEqual([
      `buildx history inspect --builder default ${ID} | ${dir}`,
    ])
  })

  test("running while its duration says so", async () => {
    const docker = standIn()
    docker.script(
      "inspect.out",
      "Context:   -\nStarted:   2026-11-27 10:00:00\nDuration:  5.2s (running)\nBuild Steps: 2/5 (0% cached)\n"
    )
    expect(await recordState(ref(home()), 1000)).toBe("running")
    docker.script("inspect.out", "Status:\tRunning\n")
    expect(await recordState(ref(home()), 1000)).toBe("running")
  })

  test("ended once completed, failed or cancelled", async () => {
    const docker = standIn()
    for (const out of [
      "Duration: 1m 30s\nBuild Steps: 6/6 (17% cached)\n",
      "Duration: 10.3s\nStatus: Canceled\nBuild Steps: 5/5 (20% cached)\n",
      'Duration: 3.1s\nError: Unknown process "/bin/sh -c false" did not complete successfully: exit code: 1\n',
      "Status: Completed\n",
    ]) {
      docker.script("inspect.out", out)
      expect(await recordState(ref(home()), 1000)).toBe("ended")
    }
  })

  test("unknown when Docker fails or says nothing it can read", async () => {
    const docker = standIn()
    docker.script(
      "inspect.out",
      "ERROR: ref kcf12h1o0p8v2vw7ly89cnofl is deleted\n"
    )
    docker.script("inspect.code", "1")
    expect(await recordState(ref(home()), 1000)).toBe("unknown")
    docker.script("inspect.code", "0")
    docker.script("inspect.out", "something else\n")
    expect(await recordState(ref(home()), 1000)).toBe("unknown")
  })

  test("cut at its limit is unknown", async () => {
    const docker = standIn()
    docker.script("hang", "")
    const started = Date.now()
    expect(await recordState(ref(home()), 200)).toBe("unknown")
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe("removeRecord", () => {
  test("removes the record by its builder, then deletes the ref file", async () => {
    const docker = standIn()
    const dir = home()
    writeRef(dir, ID, "desktop-linux")
    const [ref] = leftRefs(dir)
    expect(await removeRecord(ref!)).toBe(true)
    expect(docker.calls()).toEqual([
      `buildx history rm --builder desktop-linux ${ID} | ${dir}`,
    ])
    expect(existsSync(refFile(ref!))).toBe(false)
    expect(leftRefs(dir)).toEqual([])
  })

  test("a removal that fails keeps the file, and leftRefs names it", async () => {
    const docker = standIn()
    docker.script("rm.code", "1")
    const dir = home()
    writeRef(dir, ID)
    const [ref] = leftRefs(dir)
    expect(await removeRecord(ref!)).toBe(false)
    expect(existsSync(refFile(ref!))).toBe(true)
    expect(leftRefs(dir)).toEqual([ref!])
    // The next deploy tries it again, and it goes once Docker removes it.
    docker.script("rm.code", "0")
    expect(await removeRecord(ref!)).toBe(true)
    expect(leftRefs(dir)).toEqual([])
  })

  test("a record with no ref file here is never touched", async () => {
    const docker = standIn()
    const dir = home()
    writeRef(dir, ID)
    // OTHER is a record Docker keeps of a build the runner did not start.
    for (const ref of leftRefs(dir)) await removeRecord(ref)
    expect(
      await removeRecord({
        home: dir,
        builder: "default",
        node: "default",
        id: OTHER,
      })
    ).toBe(true)
    expect(docker.calls()).toEqual([
      `buildx history rm --builder default ${ID} | ${dir}`,
    ])
  })

  test("a ref whose names do not fit is never passed to Docker", async () => {
    const docker = standIn()
    const dir = home()
    writeRef(dir, "-rf")
    expect(
      await removeRecord({
        home: dir,
        builder: "default",
        node: "default",
        id: "-rf",
      })
    ).toBe(false)
    expect(
      await recordState(
        { home: dir, builder: "--all", node: "default", id: ID },
        1000
      )
    ).toBe("unknown")
    expect(docker.calls()).toEqual([])
    expect(
      existsSync(join(dir, "buildx", "refs", "default", "default", "-rf"))
    ).toBe(true)
  })
})
