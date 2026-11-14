import { describe, expect, spyOn, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../runner/test/helpers"
import { accept, acceptedLinks, isAccepted, LINKS_BYTES, LINKS_FILE, LINKS_KEPT, sha256Of } from "../src/accepted"
import { readCompose } from "../src/compose-read"
import { CliError, UsageError } from "../src/errors"
import { composeFor, findProject, flatKeys, notAccepted, PROJECT_BYTES, withProject, writeProject, type Details, type ProjectLink } from "../src/project"
import { machine, ready } from "./helpers"

const LINK = { app: "demo", server: "dev", compose: "compose.yaml" }
const json = (value: unknown) => JSON.stringify(value)

/** A folder tree for searching: a home folder with a project in it, and a folder outside home. Real paths, with no link in them. */
function tree() {
  const root = realpathSync(tempDir("tree"))
  const home = join(root, "home", "ada")
  const project = join(home, "code", "shop")
  const sub = join(project, "web", "src")
  const outside = join(root, "srv", "shop")
  for (const dir of [sub, outside]) mkdirSync(dir, { recursive: true })
  return { root, home, project, sub, outside }
}

/** The sentence a function throws, and whether it is the person's to fix (1) or wrong usage (2). */
function thrown(work: () => unknown): { status: 1 | 2; message: string } | undefined {
  try {
    work()
  } catch (error) {
    if (error instanceof UsageError) return { status: 2, message: error.message }
    if (error instanceof CliError) return { status: 1, message: error.message }
    throw error
  }
  return undefined
}

describe("finding zekno.json", () => {
  test("in the current folder, then each folder above it", () => {
    const t = tree()
    writeFileSync(join(t.project, "zekno.json"), json(LINK))
    // The SHA-256 is of the bytes that were read: what links.json compares.
    expect(findProject(t.project, t.home)).toEqual({ ...LINK, folder: t.project, path: join(t.project, "zekno.json"), sha256: sha256Of(json(LINK)) })
    expect(findProject(t.sub, t.home)).toMatchObject({ app: "demo", folder: t.project })
    // The nearest one wins.
    writeFileSync(join(t.sub, "zekno.json"), json({ ...LINK, app: "web" }))
    expect(findProject(t.sub, t.home)).toMatchObject({ app: "web", folder: t.sub })
  })

  test("none at all is no project file, not an error", () => {
    const t = tree()
    expect(findProject(t.sub, t.home)).toBeUndefined()
    expect(findProject(t.outside, t.home)).toBeUndefined()
  })

  test("the search stops at the home folder, whose own zekno.json counts, and never reads one above home", () => {
    const t = tree()
    writeFileSync(join(t.root, "home", "zekno.json"), json({ ...LINK, app: "planted" }))
    writeFileSync(join(t.root, "zekno.json"), json({ ...LINK, app: "planted" }))
    expect(findProject(t.sub, t.home)).toBeUndefined()
    writeFileSync(join(t.home, "zekno.json"), json({ ...LINK, app: "everywhere" }))
    expect(findProject(t.sub, t.home)).toMatchObject({ app: "everywhere", folder: t.home })
  })

  test("outside home it goes up to the filesystem root, but still never into a folder above home", () => {
    const t = tree()
    // `root` holds home: from outside home, a zekno.json there is still above home, and is not read.
    writeFileSync(join(t.root, "zekno.json"), json({ ...LINK, app: "planted" }))
    expect(findProject(t.outside, t.home)).toBeUndefined()
    writeFileSync(join(t.root, "srv", "zekno.json"), json({ ...LINK, app: "srv" }))
    expect(findProject(t.outside, t.home)).toMatchObject({ app: "srv", folder: join(t.root, "srv") })
    // Started above home itself, nothing is read.
    expect(findProject(join(t.root, "home"), t.home)).toBeUndefined()
    expect(findProject("/", t.home)).toBeUndefined()
  })

  test("a home folder reached through a link counts as home too", () => {
    const t = tree()
    const alias = join(t.root, "alias")
    symlinkSync(t.home, alias)
    writeFileSync(join(t.root, "home", "zekno.json"), json({ ...LINK, app: "planted" }))
    expect(findProject(t.sub, alias)).toBeUndefined()
  })

  test("compose defaults to compose.yaml", () => {
    const t = tree()
    writeFileSync(join(t.project, "zekno.json"), json({ app: "demo", server: "dev" }))
    expect(findProject(t.project, t.home)).toMatchObject({ compose: "compose.yaml" })
  })

  test("only a file named exactly zekno.json counts: on a file system that ignores case, ZEKNO.JSON is not one", () => {
    const t = tree()
    writeFileSync(join(t.project, "ZEKNO.JSON"), json({ ...LINK, app: "payments" }))
    expect(findProject(t.sub, t.home)).toBeUndefined()
    // Above it, the right name still applies.
    writeFileSync(join(t.home, "zekno.json"), json(LINK))
    expect(findProject(t.sub, t.home)).toMatchObject({ app: "demo", folder: t.home })
  })
})

describe("a zekno.json that is not right stops the command and names it", () => {
  const cases: [string, string, string][] = [
    ["not JSON", "{ app: demo", "is not valid JSON."],
    ["not UTF-8", "\xff\xfe{}", "is not valid JSON."],
    ["not an object", json(["demo", "dev"]), 'is not a JSON object with an "app", a "server" and a "compose".'],
    ["null", "null", 'is not a JSON object with an "app", a "server" and a "compose".'],
    ["an unknown field", json({ ...LINK, token: "x" }), 'has a field zekno does not read: "token". It holds only "app", "server" and "compose".'],
    ["a secret", json({ ...LINK, secrets: { API_KEY: "v" } }), 'has a field zekno does not read: "secrets".'],
    ["an unknown field with escapes", json({ ...LINK, "\u001b]52;c;aGk=\u0007x": 1 }), 'has a field zekno does not read: "x".'],
    ["no app", json({ server: "dev" }), 'needs "app": an app name of lowercase letters, digits and hyphens.'],
    ["an app outside the pattern", json({ ...LINK, app: "../etc" }), 'needs "app"'],
    ["an app with an escape", json({ ...LINK, app: "demo\u001b[2J" }), 'needs "app"'],
    ["a server outside the pattern", json({ ...LINK, server: "Prod Server" }), 'needs "server"'],
    ["a number for a server", json({ ...LINK, server: 1 }), 'needs "server"'],
    ["compose with ..", json({ ...LINK, compose: "../other/compose.yaml" }), 'has a "compose" that is not a relative path inside its folder.'],
    ["compose with .. inside", json({ ...LINK, compose: "a/../../b.yaml" }), 'has a "compose"'],
    ["an absolute compose", json({ ...LINK, compose: "/etc/passwd" }), 'has a "compose"'],
    ["a backslash", json({ ...LINK, compose: "..\\x.yaml" }), 'has a "compose"'],
    ["a control character", json({ ...LINK, compose: "c\u001b[2J.yaml" }), 'has a "compose"'],
    ["an empty compose", json({ ...LINK, compose: "" }), 'has a "compose"'],
    ["too large", json({ ...LINK, compose: `${"a/".repeat(PROJECT_BYTES)}c.yaml` }), `is larger than the ${PROJECT_BYTES} bytes a project file may have.`],
    ["a field written twice", '{"app":"good","server":"dev","app":"evil"}', "has the same field more than once."],
    ["a field written twice, once escaped", '{"app":"good","server":"dev","\\u0061pp":"evil"}', "has the same field more than once."],
  ]
  for (const [name, content, problem] of cases) {
    test(name, () => {
      const t = tree()
      writeFileSync(join(t.project, "zekno.json"), Buffer.from(content, name === "not UTF-8" ? "latin1" : "utf8"))
      const failure = thrown(() => findProject(t.sub, t.home))
      expect(failure?.status).toBe(1)
      expect(failure?.message).toStartWith(`${join(t.project, "zekno.json")} ${problem}`)
      // Nothing from the file reaches the sentence but cleaned field names.
      expect(failure?.message).not.toContain("\u001b")
    })
  }

  test("a symbolic link, even to a good file in the same folder", () => {
    const t = tree()
    writeFileSync(join(t.project, "real.json"), json(LINK))
    symlinkSync(join(t.project, "real.json"), join(t.project, "zekno.json"))
    expect(thrown(() => findProject(t.project, t.home))).toEqual({
      status: 1,
      message: `${join(t.project, "zekno.json")} is a symbolic link. zekno reads zekno.json only as a file of its own, never through a link.`,
    })
  })

  test("a folder, or a named pipe, which is never opened", () => {
    const t = tree()
    mkdirSync(join(t.project, "zekno.json"))
    expect(thrown(() => findProject(t.project, t.home))?.message).toBe(`${join(t.project, "zekno.json")} is not a file.`)
    Bun.spawnSync(["mkfifo", join(t.sub, "zekno.json")])
    expect(thrown(() => findProject(t.sub, t.home))?.message).toBe(`${join(t.sub, "zekno.json")} is not a file.`)
  })

  test("a file that belongs to another user", () => {
    const t = tree()
    writeFileSync(join(t.project, "zekno.json"), json(LINK))
    const uid = spyOn(process, "getuid").mockReturnValue(statSync(t.project).uid + 1)
    try {
      expect(thrown(() => findProject(t.project, t.home))?.message).toBe(`${join(t.project, "zekno.json")} belongs to another user, so zekno does not use it.`)
    } finally {
      uid.mockRestore()
    }
  })

  test("a folder name with escape sequences is cleaned in the sentence", () => {
    const t = tree()
    const odd = join(t.home, "x\u001b]0;title\u0007y")
    mkdirSync(odd)
    writeFileSync(join(odd, "zekno.json"), "nope")
    expect(thrown(() => findProject(odd, t.home))?.message).toBe(`${join(t.home, "xy", "zekno.json")} is not valid JSON.`)
  })
})

describe("the Compose file it names, read once", () => {
  const linked = (folder: string, compose: string): ProjectLink => ({
    app: "demo",
    server: "dev",
    compose,
    folder,
    path: join(folder, "zekno.json"),
    sha256: "",
  })
  const read = (folder: string, compose: string) => readCompose({ kind: "project", link: linked(folder, compose) })

  test("is a file inside the project file's folder; its text is returned with its real path", () => {
    const t = tree()
    mkdirSync(join(t.project, "deploy"))
    writeFileSync(join(t.project, "deploy", "prod.yaml"), "services: {}\n")
    expect(read(t.project, "deploy/prod.yaml")).toEqual({ text: "services: {}\n", path: join(t.project, "deploy", "prod.yaml") })
    // A link that stays inside the folder is followed.
    symlinkSync(join(t.project, "deploy", "prod.yaml"), join(t.project, "compose.yaml"))
    expect(read(t.project, "compose.yaml")).toEqual({ text: "services: {}\n", path: join(t.project, "deploy", "prod.yaml") })
  })

  test("a missing file says so", () => {
    const t = tree()
    expect(thrown(() => read(t.project, "compose.yaml"))?.message).toBe(
      `${join(t.project, "zekno.json")} names compose.yaml as the Compose file, and there is no such file in ${t.project}.`
    )
  })

  test("a link that leads out of the folder is never followed, to a file or through a folder", () => {
    const t = tree()
    writeFileSync(join(t.root, "secret.txt"), "not for sending")
    symlinkSync(join(t.root, "secret.txt"), join(t.project, "compose.yaml"))
    expect(thrown(() => read(t.project, "compose.yaml"))?.message).toBe(
      `compose.yaml, named by ${join(t.project, "zekno.json")}, leads outside the folder that holds it. zekno does not follow it there.`
    )
    symlinkSync(t.root, join(t.project, "up"))
    expect(thrown(() => read(t.project, "up/secret.txt"))?.message).toContain("leads outside the folder that holds it")
  })

  test("a folder or a named pipe is not a Compose file, and a pipe is never waited on", () => {
    const t = tree()
    mkdirSync(join(t.project, "compose.yaml"))
    expect(thrown(() => read(t.project, "compose.yaml"))?.message).toBe(`compose.yaml, named by ${join(t.project, "zekno.json")}, is not a file.`)
    Bun.spawnSync(["mkfifo", join(t.project, "pipe.yaml")])
    expect(thrown(() => read(t.project, "pipe.yaml"))?.message).toBe(`pipe.yaml, named by ${join(t.project, "zekno.json")}, is not a file.`)
  })

  test("a file with a second name on the disk (a hard link) is refused: it could be a file outside the folder", () => {
    const t = tree()
    writeFileSync(join(t.root, "private.yaml"), "services:\n  leak:\n    image: private\n")
    linkSync(join(t.root, "private.yaml"), join(t.project, "compose.yaml"))
    expect(thrown(() => read(t.project, "compose.yaml"))?.message).toBe(
      `compose.yaml, named by ${join(t.project, "zekno.json")}, has more than one name on this disk (a hard link), so zekno cannot tell that it stays inside its folder.`
    )
  })

  test("another user's file, and one larger than a deploy may carry, are refused", () => {
    const t = tree()
    writeFileSync(join(t.project, "big.yaml"), "x".repeat(LIMITS.composeBytes + 1))
    expect(thrown(() => read(t.project, "big.yaml"))?.message).toBe("The Compose file is larger than the 256 KiB limit.")
    writeFileSync(join(t.project, "compose.yaml"), "services: {}\n")
    const uid = spyOn(process, "getuid").mockReturnValue(statSync(t.project).uid + 1)
    try {
      expect(thrown(() => read(t.project, "compose.yaml"))?.message).toBe(
        `compose.yaml, named by ${join(t.project, "zekno.json")}, belongs to another user, so zekno does not use it.`
      )
    } finally {
      uid.mockRestore()
    }
  })

  test("with nothing naming another, compose.yaml in the folder, which must stay inside it too", () => {
    const t = tree()
    writeFileSync(join(t.project, "compose.yaml"), "services: {}\n")
    expect(readCompose({ kind: "default", folder: t.project })).toEqual({ text: "services: {}\n", path: join(t.project, "compose.yaml") })
    rmSync(join(t.project, "compose.yaml"))
    writeFileSync(join(t.root, "secret.txt"), "not for sending")
    symlinkSync(join(t.root, "secret.txt"), join(t.project, "compose.yaml"))
    expect(thrown(() => readCompose({ kind: "default", folder: t.project }))).toEqual({
      status: 1,
      message: "compose.yaml leads outside this folder through a symbolic link, so zekno does not read it. To deploy that file, name it with `-f <file>`.",
    })
    expect(thrown(() => readCompose({ kind: "default", folder: t.sub }))?.message).toBe(`No Compose file at ${join(t.sub, "compose.yaml")}. Point to one with \`-f <file>\`.`)
  })

  test("a file named with -f is the person's to name, anywhere, but is still a regular file within the limit, never a pipe", () => {
    const t = tree()
    writeFileSync(join(t.root, "elsewhere.yaml"), "services: {}\n")
    symlinkSync(join(t.root, "elsewhere.yaml"), join(t.project, "linked.yaml"))
    expect(readCompose({ kind: "given", path: join(t.project, "linked.yaml") }).text).toBe("services: {}\n")
    Bun.spawnSync(["mkfifo", join(t.project, "pipe.yaml")])
    expect(thrown(() => readCompose({ kind: "given", path: join(t.project, "pipe.yaml") }))?.message).toBe(`${join(t.project, "pipe.yaml")} is not a file.`)
    expect(thrown(() => readCompose({ kind: "given", path: t.project }))?.message).toBe(`${t.project} is not a file.`)
    writeFileSync(join(t.project, "big.yaml"), "x".repeat(LIMITS.composeBytes + 1))
    expect(thrown(() => readCompose({ kind: "given", path: join(t.project, "big.yaml") }))?.message).toBe("The Compose file is larger than the 256 KiB limit.")
  })
})

describe("flags win over the file, and only a file this machine accepted is used", () => {
  /** A tree whose zekno.json is accepted in a profile folder of its own. */
  function acceptedTree(content: unknown = LINK) {
    const t = tree()
    const profile = tempDir("profile")
    writeFileSync(join(t.project, "zekno.json"), json(content))
    writeFileSync(join(t.project, "compose.yaml"), "services: {}\n")
    accept(profile, findProject(t.project, t.home)!)
    return { ...t, profile, places: { profile, home: t.home } }
  }

  test("each detail not given comes from an accepted file; the server's source is named for its sentence", () => {
    const t = acceptedTree()
    const link = findProject(t.project, t.home)!
    expect(withProject<Details>(t.sub, {}, ["app", "server", "file"], t.places)).toEqual({
      app: "demo",
      server: "dev",
      serverFrom: join(t.project, "zekno.json"),
      project: link,
    })
    expect(withProject<Details>(t.sub, { server: "prod" }, ["app", "server"], t.places)).toEqual({ app: "demo", server: "prod" })
  })

  test("its Compose file goes with its app: another --app gets -f or the current folder's compose.yaml, the same app gets the file's", () => {
    const t = acceptedTree()
    expect(withProject<Details>(t.sub, { app: "other" }, ["app", "server", "file"], t.places)).toEqual({
      app: "other",
      server: "dev",
      serverFrom: join(t.project, "zekno.json"),
    })
    expect(withProject<Details>(t.sub, { app: "other", server: "dev" }, ["app", "server", "file"], t.places)).toEqual({ app: "other", server: "dev" })
    expect(withProject<Details>(t.sub, { app: "demo", server: "dev" }, ["app", "server", "file"], t.places)).toMatchObject({ project: { app: "demo" } })
    expect(withProject<Details>(t.sub, { file: "x.yaml" }, ["app", "server", "file"], t.places)).toEqual({
      app: "demo",
      server: "dev",
      serverFrom: join(t.project, "zekno.json"),
      file: "x.yaml",
    })
  })

  test("a file this machine did not accept stops a command that needs a name from it; given --app and --server it is left aside", () => {
    const t = tree()
    const places = { profile: tempDir("profile"), home: t.home }
    writeFileSync(join(t.project, "zekno.json"), json(LINK))
    const link = findProject(t.project, t.home)!
    const sentence = `zekno.json in ${t.project} names demo on dev. It was not made or accepted on this machine. To use it, run \`zekno link\` in that folder. To leave it aside, give --app and --server.`
    expect(notAccepted(link)).toBe(sentence)
    for (const given of [{}, { app: "demo" }, { server: "dev" }] as Details[]) {
      expect(thrown(() => withProject(t.sub, given, ["app", "server", "file"], places))).toEqual({ status: 2, message: sentence })
    }
    expect(thrown(() => withProject(t.sub, {}, ["server"], places))).toEqual({ status: 2, message: sentence })
    // Its Compose file is not taken either.
    expect(withProject<Details>(t.sub, { app: "demo", server: "dev" }, ["app", "server", "file"], places)).toEqual({ app: "demo", server: "dev" })
  })

  test("any change to its bytes makes it not accepted again; accepting it again uses it", () => {
    const t = acceptedTree()
    expect(withProject<Details>(t.sub, {}, ["app", "server"], t.places)).toMatchObject({ app: "demo" })
    // An edit, or a `git pull`, that changes one byte.
    writeFileSync(join(t.project, "zekno.json"), `${json(LINK)}\n`)
    expect(thrown(() => withProject(t.sub, {}, ["app", "server"], t.places))?.status).toBe(2)
    writeFileSync(join(t.project, "zekno.json"), json({ ...LINK, app: "evil" }))
    expect(thrown(() => withProject(t.sub, {}, ["app", "server"], t.places))?.message).toContain("names evil on dev.")
    accept(t.profile, findProject(t.project, t.home)!)
    expect(withProject<Details>(t.sub, {}, ["app", "server"], t.places)).toMatchObject({ app: "evil" })
    // The same bytes in another folder are another file.
    writeFileSync(join(t.home, "zekno.json"), json({ ...LINK, app: "evil" }))
    expect(thrown(() => withProject(t.home, {}, ["app", "server"], t.places))?.status).toBe(2)
  })

  test("a command given every detail never reads the file, so a broken one does not get in its way", () => {
    const t = tree()
    writeFileSync(join(t.project, "zekno.json"), "{ broken")
    const given = { app: "demo", server: "dev", file: "c.yaml", json: true }
    const places = { profile: tempDir("profile"), home: t.home }
    expect(withProject(t.project, given, ["app", "server", "file"], places)).toBe(given)
    expect(thrown(() => withProject(t.project, { app: "demo" }, ["app", "server"], places))?.message).toContain("is not valid JSON.")
  })

  test("given --app and --server, a file that cannot be read is no file: here or above, a link, bad JSON or another user's", () => {
    const t = tree()
    const places = { profile: tempDir("profile"), home: t.home }
    const both = { app: "demo", server: "dev" }
    const broken: [string, () => void][] = [
      ["bad JSON here", () => writeFileSync(join(t.sub, "zekno.json"), "{ broken")],
      ["bad JSON above", () => writeFileSync(join(t.project, "zekno.json"), "{ broken")],
      ["a link", () => symlinkSync("/etc/hosts", join(t.sub, "zekno.json"))],
    ]
    for (const [what, plant] of broken) {
      rmSync(join(t.sub, "zekno.json"), { force: true })
      rmSync(join(t.project, "zekno.json"), { force: true })
      plant()
      expect({ what, details: withProject<Details>(t.sub, both, ["app", "server", "file"], places) }).toEqual({ what, details: both })
      // A command that needs a name from it is still stopped, and says why.
      expect({ what, problem: thrown(() => withProject(t.sub, { app: "demo" }, ["app", "server", "file"], places))?.status }).toEqual({ what, problem: 1 })
    }
    // Another user's: where there are user ids, a file that is not this user's is refused the same way.
    const getuid = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 1)
    try {
      rmSync(join(t.sub, "zekno.json"), { force: true })
      writeFileSync(join(t.sub, "zekno.json"), json(LINK))
      expect(withProject<Details>(t.sub, both, ["app", "server", "file"], places)).toEqual(both)
      expect(thrown(() => withProject(t.sub, {}, ["app", "server"], places))?.message).toContain("belongs to another user")
    } finally {
      getuid.mockRestore()
    }
  })

  test("with no file, what was given is passed on as it is", () => {
    const t = tree()
    expect(withProject(t.sub, { app: "demo" }, ["app", "server"], { profile: tempDir("profile"), home: t.home })).toEqual({ app: "demo" })
  })

  test("a duplicate field is noticed however it is written; other shapes are not read as flat", () => {
    expect(flatKeys('{"app":"a","server":"s"}')).toEqual(["app", "server"])
    expect(flatKeys(' { "app" : "a" , "\\u0061pp" : "b" } ')).toEqual(["app", "app"])
    expect(flatKeys('{"a":"x\\"y"}')).toEqual(["a"])
    expect(flatKeys("{}")).toEqual([])
    for (const text of ['["a"]', '{"a":1}', '{"a":"b"', '{"a" "b"}', '{"a":"b",}']) expect(flatKeys(text)).toBeUndefined()
  })
})

describe("the list of accepted project files (links.json)", () => {
  const entry = (n: number) => ({ path: `/code/p${n}/zekno.json`, sha256: sha256Of(String(n)) })

  test("holds the real path and the SHA-256 of each accepted file, mode 600, newest last, one entry per path", () => {
    const home = tempDir("profile")
    accept(home, entry(1))
    accept(home, entry(2))
    accept(home, { ...entry(1), sha256: sha256Of("changed") })
    expect(acceptedLinks(home)).toEqual([entry(2), { ...entry(1), sha256: sha256Of("changed") }])
    expect(isAccepted(home, entry(1))).toBe(false)
    expect(isAccepted(home, entry(2))).toBe(true)
    expect(statSync(join(home, LINKS_FILE)).mode & 0o777).toBe(0o600)
    expect(readdirSync(home)).toEqual([LINKS_FILE])
  })

  test("keeps at most 500, dropping the oldest", () => {
    const home = tempDir("profile")
    writeFileSync(join(home, LINKS_FILE), JSON.stringify(Array.from({ length: LINKS_KEPT }, (_, n) => entry(n))))
    accept(home, entry(LINKS_KEPT))
    const kept = acceptedLinks(home)
    expect(kept).toHaveLength(LINKS_KEPT)
    expect(kept[0]).toEqual(entry(1))
    expect(kept.at(-1)).toEqual(entry(LINKS_KEPT))
  })

  test("a damaged, oversized, linked or other-shaped file counts as empty, accepts nothing, and the next write replaces it", () => {
    const cases: [string, (path: string) => void][] = [
      ["not JSON", (path) => writeFileSync(path, "{ nope")],
      ["another shape", (path) => writeFileSync(path, JSON.stringify({ links: [entry(1)] }))],
      ["an unknown field", (path) => writeFileSync(path, JSON.stringify([{ ...entry(1), trusted: true }]))],
      ["a hash that is not one", (path) => writeFileSync(path, JSON.stringify([{ ...entry(1), sha256: "x" }]))],
      ["more than 500", (path) => writeFileSync(path, JSON.stringify(Array.from({ length: LINKS_KEPT + 1 }, () => entry(1))))],
      ["too large", (path) => writeFileSync(path, `${JSON.stringify([entry(1)])}${" ".repeat(LINKS_BYTES)}`)],
      ["a named pipe", (path) => Bun.spawnSync(["mkfifo", path])],
    ]
    for (const [name, make] of cases) {
      const home = tempDir("profile")
      make(join(home, LINKS_FILE))
      expect({ name, accepted: isAccepted(home, entry(1)) }).toEqual({ name, accepted: false })
      accept(home, entry(2))
      expect({ name, links: acceptedLinks(home) }).toEqual({ name, links: [entry(2)] })
    }
  })

  test("a link in its place is not read, and is replaced rather than written through", () => {
    const home = tempDir("profile")
    const target = join(tempDir("elsewhere"), "links.json")
    writeFileSync(target, JSON.stringify([entry(1)]))
    symlinkSync(target, join(home, LINKS_FILE))
    expect(isAccepted(home, entry(1))).toBe(false)
    accept(home, entry(2))
    expect(lstatSync(join(home, LINKS_FILE)).isSymbolicLink()).toBe(false)
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual([entry(1)])
    expect(acceptedLinks(home)).toEqual([entry(2)])
  })

  test("a profile folder that cannot be written to says so", () => {
    expect(thrown(() => accept(join(tempDir("profile"), "missing"), entry(1)))?.message).toStartWith("Could not write ")
  })
})

describe("writing zekno.json", () => {
  test("three names and nothing else, mode 644, as one whole file; no temporary file is left", () => {
    const dir = tempDir("write")
    const path = writeProject(dir, LINK)
    expect(path).toBe(join(dir, "zekno.json"))
    expect(readFileSync(path, "utf8")).toBe('{\n  "app": "demo",\n  "server": "dev",\n  "compose": "compose.yaml"\n}\n')
    expect(statSync(path).mode & 0o777).toBe(0o644)
    expect(readdirSync(dir)).toEqual(["zekno.json"])
  })

  test("what is written is held to the same rules as what is read", () => {
    const dir = tempDir("write")
    expect(() => writeProject(dir, { ...LINK, app: "../x" })).toThrow()
    expect(() => writeProject(dir, { ...LINK, compose: "../compose.yaml" })).toThrow()
    expect(() => writeProject(dir, { ...LINK, token: "secret" } as typeof LINK)).not.toThrow()
    // Only the three names are taken: anything else handed in is not written.
    expect(readFileSync(join(dir, "zekno.json"), "utf8")).not.toContain("secret")
  })

  test("an existing one is never replaced without force; with force it is", () => {
    const dir = tempDir("write")
    writeFileSync(join(dir, "zekno.json"), "mine")
    expect(thrown(() => writeProject(dir, LINK))).toEqual({
      status: 1,
      message: `There is already a zekno.json in ${dir}. Run \`zekno link --force\` to replace it.`,
    })
    expect(readFileSync(join(dir, "zekno.json"), "utf8")).toBe("mine")
    writeProject(dir, { ...LINK, app: "web" }, true)
    expect(JSON.parse(readFileSync(join(dir, "zekno.json"), "utf8"))).toMatchObject({ app: "web" })
    expect(readdirSync(dir)).toEqual(["zekno.json"])
  })

  test("never through a link: without force a link counts as a file there, with force the link itself is replaced", () => {
    const dir = tempDir("write")
    const target = join(tempDir("elsewhere"), "victim")
    writeFileSync(target, "untouched")
    symlinkSync(target, join(dir, "zekno.json"))
    expect(thrown(() => writeProject(dir, LINK))?.message).toContain("There is already a zekno.json")
    writeProject(dir, LINK, true)
    expect(readFileSync(target, "utf8")).toBe("untouched")
    expect(findProject(dir, dir)).toMatchObject(LINK)
    // A link to nowhere is a file there too.
    const other = tempDir("write")
    symlinkSync(join(other, "nowhere"), join(other, "zekno.json"))
    expect(thrown(() => writeProject(other, LINK))?.message).toContain("There is already a zekno.json")
    expect(existsSync(join(other, "nowhere"))).toBe(false)
  })

  test("a folder that cannot be written to says so", () => {
    expect(thrown(() => writeProject(join(tempDir("write"), "missing"), LINK))?.message).toStartWith("Could not write ")
  })
})

describe("the Compose file `zekno link -f` names", () => {
  test("is kept relative to the folder, and must be a file inside it", () => {
    const t = tree()
    mkdirSync(join(t.project, "deploy"))
    writeFileSync(join(t.project, "deploy", "prod.yaml"), "services: {}\n")
    writeFileSync(join(t.project, "compose.yaml"), "services: {}\n")
    expect(composeFor(t.project, "compose.yaml")).toBe("compose.yaml")
    expect(composeFor(t.project, "./deploy/prod.yaml")).toBe("deploy/prod.yaml")
    expect(composeFor(t.project, join(t.project, "deploy", "prod.yaml"))).toBe("deploy/prod.yaml")
    for (const outside of ["../other.yaml", "/etc/hosts", ".", t.root]) {
      expect(thrown(() => composeFor(t.project, outside))).toEqual({
        status: 2,
        message: "The Compose file has to be inside this folder, since zekno.json names it from here.",
      })
    }
    expect(thrown(() => composeFor(t.project, "missing.yaml"))?.message).toBe(`No Compose file at ${join(t.project, "missing.yaml")}. Point to one with \`-f <file>\`.`)
    symlinkSync(join(t.root, "srv"), join(t.project, "srv"))
    writeFileSync(join(t.root, "srv", "c.yaml"), "services: {}\n")
    expect(thrown(() => composeFor(t.project, "srv/c.yaml"))?.message).toBe(
      "srv/c.yaml leads outside this folder through a symbolic link, so zekno.json cannot name it."
    )
  })
})

describe("zekno link", () => {
  test("writes zekno.json in the current folder from the flags, with the server checked against the verified profile", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toBe(
      `Wrote ${join(m.project, "zekno.json")}: this folder deploys web to dev from compose.yaml. It holds no secret and is safe to commit.`
    )
    expect(JSON.parse(readFileSync(join(m.project, "zekno.json"), "utf8"))).toEqual({ app: "web", server: "dev", compose: "compose.yaml" })
  })

  test("refuses to replace one without --force; with --force a name not given is kept from it", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("link", "--app", "api", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe(`There is already a zekno.json in ${m.project}. Run \`zekno link --force\` to replace it.`)
    m.compose("services: {}\n", "other.yaml")
    expect(await m.zekno("link", "--app", "api", "-f", "other.yaml", "--force")).toBe(0)
    expect(JSON.parse(readFileSync(join(m.project, "zekno.json"), "utf8"))).toEqual({ app: "api", server: "dev", compose: "other.yaml" })
  })

  test("what it writes is accepted on this machine: links.json holds its real path and the SHA-256 of its bytes", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    const path = join(realpathSync(m.project), "zekno.json")
    expect(acceptedLinks(m.home)).toEqual([{ path, sha256: sha256Of(readFileSync(path)) }])
  })

  test("with no names, it accepts a zekno.json that came from elsewhere as it is, without rewriting it, once its server is connected", async () => {
    const m = await ready()
    const path = join(m.project, "zekno.json")
    const text = '{"app":"web","server":"dev"}'
    writeFileSync(path, text)
    expect(await m.zekno("link")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: web on dev, file compose.yaml.")
    expect(readFileSync(path, "utf8")).toBe(text)
    expect(isAccepted(m.home, findProject(m.project)!)).toBe(true)
    // From a folder below, the one that applies is accepted, and named.
    writeFileSync(path, '{"app":"api","server":"dev"}')
    mkdirSync(join(m.project, "sub"))
    m.deps.cwd = join(m.project, "sub")
    expect(await m.zekno("link")).toBe(0)
    expect(m.lastOut()).toBe(`Accepted ${join(realpathSync(m.project), "zekno.json")}: api on dev, file compose.yaml.`)
    expect(readdirSync(join(m.project, "sub"))).toEqual([])
    m.deps.cwd = m.project
    // Names that are exactly its own accept it too, with no --force; others need --force, as before.
    writeFileSync(path, '{"app":"web","server":"dev"}')
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: web on dev, file compose.yaml.")
    expect(readFileSync(path, "utf8")).toBe('{"app":"web","server":"dev"}')
  })

  test("a zekno.json naming a server that is not connected, or a Compose file that is not there, is not accepted", async () => {
    const m = await ready()
    const path = join(m.project, "zekno.json")
    writeFileSync(path, json({ app: "web", server: "prod" }))
    expect(await m.zekno("link")).toBe(1)
    expect(m.lastErr()).toBe(`${join(realpathSync(m.project), "zekno.json")} names a server "prod" that is not connected to this machine. Connected servers: dev.`)
    writeFileSync(path, json({ app: "web", server: "dev", compose: "missing.yaml" }))
    expect(await m.zekno("link")).toBe(1)
    expect(m.lastErr()).toBe(`No Compose file at ${join(realpathSync(m.project), "missing.yaml")}. Point to one with \`-f <file>\`.`)
    expect(acceptedLinks(m.home)).toEqual([])
  })

  test("a missing detail is wrong usage naming the flag and the project file; an unknown server names itself", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--server", "dev")).toBe(2)
    expect(m.err.at(-1)).toStartWith("Say which app with `--app <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.")
    expect(await m.zekno("link", "--app", "web")).toBe(2)
    expect(m.err.at(-1)).toStartWith("Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.")
    expect(await m.zekno("link", "--app", "web", "--server", "prod")).toBe(1)
    expect(m.lastErr()).toBe('No server named "prod". Connected servers: dev.')
    expect(await m.zekno("link", "--app", "Web App", "--server", "dev")).toBe(2)
    expect(await m.zekno("link", "--app", "web", "--server", "dev", "-f", "../elsewhere.yaml")).toBe(2)
    expect(await m.zekno("link", "--app", "web", "--server", "dev", "-f", "missing.yaml")).toBe(1)
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
  })

  test("before `init` it says what to run first and writes nothing", async () => {
    const m = machine()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toContain("zekno init")
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
  })

  test("is in the help", async () => {
    const m = machine()
    expect(await m.zekno("--help")).toBe(0)
    expect(m.lastOut()).toContain("zekno link [--app <app>] [--server <name>] [-f <compose file>] [--force]")
  })
})
