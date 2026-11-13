import { describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../runner/test/helpers"
import { CliError, UsageError } from "../src/errors"
import { composeFor, findProject, PROJECT_BYTES, projectCompose, withProject, writeProject, type Details } from "../src/project"
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
    expect(findProject(t.project, t.home)).toEqual({ ...LINK, folder: t.project, path: join(t.project, "zekno.json") })
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

describe("the Compose file it names", () => {
  const linked = (folder: string, compose: string) => ({ app: "demo", server: "dev", compose, folder, path: join(folder, "zekno.json") })

  test("is a file inside the project file's folder, returned as a real path", () => {
    const t = tree()
    mkdirSync(join(t.project, "deploy"))
    writeFileSync(join(t.project, "deploy", "prod.yaml"), "services: {}\n")
    expect(projectCompose(linked(t.project, "deploy/prod.yaml"))).toBe(join(t.project, "deploy", "prod.yaml"))
    // A link that stays inside the folder is followed.
    symlinkSync(join(t.project, "deploy", "prod.yaml"), join(t.project, "compose.yaml"))
    expect(projectCompose(linked(t.project, "compose.yaml"))).toBe(join(t.project, "deploy", "prod.yaml"))
  })

  test("a missing file says so", () => {
    const t = tree()
    expect(thrown(() => projectCompose(linked(t.project, "compose.yaml")))?.message).toBe(
      `${join(t.project, "zekno.json")} names compose.yaml as the Compose file, and there is no such file in ${t.project}.`
    )
  })

  test("a link that leads out of the folder is never followed, to a file or through a folder", () => {
    const t = tree()
    writeFileSync(join(t.root, "secret.txt"), "not for sending")
    symlinkSync(join(t.root, "secret.txt"), join(t.project, "compose.yaml"))
    expect(thrown(() => projectCompose(linked(t.project, "compose.yaml")))?.message).toBe(
      `compose.yaml, named by ${join(t.project, "zekno.json")}, leads outside the folder that holds it. zekno does not follow it there.`
    )
    symlinkSync(t.root, join(t.project, "up"))
    expect(thrown(() => projectCompose(linked(t.project, "up/secret.txt")))?.message).toContain("leads outside the folder that holds it")
  })

  test("a folder is not a Compose file", () => {
    const t = tree()
    mkdirSync(join(t.project, "compose.yaml"))
    expect(thrown(() => projectCompose(linked(t.project, "compose.yaml")))?.message).toBe(
      `compose.yaml, named by ${join(t.project, "zekno.json")}, is not a file.`
    )
  })
})

describe("flags win over the file", () => {
  test("each detail not given comes from the file; the server's source is named for its sentence", () => {
    const t = tree()
    writeFileSync(join(t.project, "zekno.json"), json(LINK))
    writeFileSync(join(t.project, "compose.yaml"), "services: {}\n")
    expect(withProject<Details>(t.sub, {}, ["app", "server", "file"], t.home)).toEqual({
      app: "demo",
      server: "dev",
      serverFrom: join(t.project, "zekno.json"),
      file: join(t.project, "compose.yaml"),
    })
    expect(withProject<Details>(t.sub, { app: "other", file: "x.yaml" }, ["app", "server", "file"], t.home)).toEqual({
      app: "other",
      server: "dev",
      serverFrom: join(t.project, "zekno.json"),
      file: "x.yaml",
    })
    expect(withProject<Details>(t.sub, { server: "prod" }, ["app", "server"], t.home)).toEqual({ app: "demo", server: "prod" })
  })

  test("a command given every detail never reads the file, so a broken one does not get in its way", () => {
    const t = tree()
    writeFileSync(join(t.project, "zekno.json"), "{ broken")
    const given = { app: "demo", server: "dev", file: "c.yaml", json: true }
    expect(withProject(t.project, given, ["app", "server", "file"], t.home)).toBe(given)
    expect(thrown(() => withProject(t.project, { app: "demo" }, ["app", "server"], t.home))?.message).toContain("is not valid JSON.")
  })

  test("with no file, what was given is passed on as it is", () => {
    const t = tree()
    expect(withProject(t.sub, { app: "demo" }, ["app", "server"], t.home)).toEqual({ app: "demo" })
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
