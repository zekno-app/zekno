/**
 * The pages of the docs (specs/013-docs-refresh, contracts/pages.md, "The
 * tests"): no page is too long, the page tree is the contract's, every link
 * leads to a page and a heading that exist, the move list points at real
 * places, no page, README or landing page names the desktop app, each page about the CLI
 * keeps its warning, and the pages and the stored screens agree
 * (contracts/screens.md). Heading ids are made the way the site makes them,
 * with the slugger the site's MDX plugin uses (research.md §6).
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import { createHeadingIds } from "fumadocs-core/mdx-plugins/remark-heading.runtime"

import { site } from "@/config/site"

import { storedScreenNames } from "./screens"

const WEB = join(import.meta.dir, "../../..")
const ROOT = join(WEB, "../..")
const PAGES = join(WEB, "content/docs")
const MOVE_LIST = join(ROOT, "specs/013-docs-refresh/move-list.md")

/**
 * The pages of the contract, with their titles, in the order of the tree:
 * seventeen, and the two of specs/015-domains-https (tasks T079, T080).
 */
const CONTRACT: [file: string, title: string][] = [
  ["index", "Introduction"],
  ["quick-start", "Quick start"],
  ["install", "Install"],
  ["security", "Security model"],
  ["app", "The terminal app"],
  ["deploying", "Deploying"],
  ["servers", "Your key and servers"],
  ["secrets", "Secrets"],
  ["settings", "App settings"],
  ["changing-settings", "Changing settings"],
  ["domains", "Domains and HTTPS"],
  ["health-checks", "Health checks"],
  ["templates", "Templates"],
  ["project-file", "The project file"],
  ["doctor", "Doctor and version"],
  ["cli", "Commands"],
  ["output", "Output and exit status"],
  ["storage", "What is kept where"],
  ["runner", "Server runner"],
]

/**
 * `meta.json` as research.md §6 gives it: three groups, as separators, in
 * this order. The first group is "Get Started", the maintainer's name for it
 * (specs/015-domains-https, quickstart.md, M8).
 */
const META = {
  pages: [
    "---Get Started---",
    "index",
    "quick-start",
    "install",
    "security",
    "---Using zekno---",
    "app",
    "deploying",
    "servers",
    "secrets",
    "settings",
    "changing-settings",
    "domains",
    "health-checks",
    "templates",
    "project-file",
    "doctor",
    "---Reference---",
    "cli",
    "output",
    "storage",
    "runner",
  ],
}

/** The pages that need not open with the CLI's warning: the introduction has a warning of its own. */
const WITHOUT_CALLOUT = ["index"]

/** The READMEs whose links and wording are checked with the pages: the root's and each app's. */
const READMES = [
  "README.md",
  ...readdirSync(join(ROOT, "apps"))
    .map((app) => `apps/${app}/README.md`)
    .filter((path) => existsSync(join(ROOT, path))),
]

const read = (path: string): string => readFileSync(path, "utf8")

/** Every `.mdx` page in the docs folder, by name without the extension. */
const pageFiles = readdirSync(PAGES)
  .filter((file) => file.endsWith(".mdx"))
  .map((file) => file.slice(0, -".mdx".length))
  .sort()

/** The text of a page, or undefined when the file does not exist. */
function pageText(name: string): string | undefined {
  const path = join(PAGES, `${name}.mdx`)
  return existsSync(path) ? read(path) : undefined
}

/** The lines of a text that are not inside a fenced code block, with their line numbers. */
function linesOutsideCode(text: string): { line: string; number: number }[] {
  const out: { line: string; number: number }[] = []
  let fence: string | undefined
  text.split("\n").forEach((line, index) => {
    const opening = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (opening !== undefined) {
      if (fence === undefined) fence = opening[0]
      else if (opening[0] === fence) fence = undefined
      return
    }
    if (fence === undefined) out.push({ line, number: index + 1 })
  })
  return out
}

/** A heading's text as the slugger sees it: the words that show, without code marks, emphasis or a link's address. */
function headingText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, "$2")
    .trim()
}

/** The headings of a markdown text, outside code, in order: their text as it shows. */
function headingsOf(text: string): string[] {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, (front) =>
    "\n".repeat(front.split("\n").length - 1)
  )
  return linesOutsideCode(body)
    .map(({ line }) => /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1])
    .filter((heading): heading is string => heading !== undefined)
    .map(headingText)
}

/** The ids of a text's headings, made as the site makes them: one slugger per page, so a repeated heading gets `-1`, `-2`. */
function headingIds(text: string): string[] {
  const texts = headingsOf(text)
  return createHeadingIds((_props, slug) => texts.map((t) => slug([t])))({})
}

/** A page's front matter field. */
function frontMatter(text: string, field: string): string | undefined {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1]
  return front
    ?.split("\n")
    .find((line) => line.startsWith(`${field}:`))
    ?.slice(field.length + 1)
    .trim()
}

/** Every link of a markdown text outside code: `[text](address)` and `href="address"`, with its line. */
function linksOf(text: string): { address: string; number: number }[] {
  const links: { address: string; number: number }[] = []
  for (const { line, number } of linesOutsideCode(text)) {
    const plain = line.replace(/`[^`]*`/g, "")
    for (const match of plain.matchAll(
      /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|href="([^"]+)"/g
    ))
      links.push({ address: (match[1] ?? match[2])!, number })
  }
  return links
}

/** Where a link of the docs leads: a page by its name and an anchor, or undefined when it is not a link into the docs. */
function docsTarget(
  address: string,
  from: string
): { page: string; anchor?: string } | undefined {
  const [path, anchor] = address.split("#", 2) as [string, string | undefined]
  const published = `${site.url}/docs`
  let rest: string | undefined
  if (path === "/docs" || path.startsWith("/docs/")) rest = path.slice(5)
  else if (path === published || path.startsWith(`${published}/`))
    rest = path.slice(published.length)
  else if (path.endsWith(".mdx") && !/^[a-z]+:/.test(path)) {
    const file = relative(PAGES, resolve(dirname(from), path))
    if (file.startsWith("..") || file.includes("/")) return undefined
    return { page: file.slice(0, -".mdx".length), anchor }
  } else return undefined
  const page = rest.replace(/^\//, "").replace(/\/$/, "") || "index"
  return { page, anchor }
}

/** The problems with the links of one file: each link into the docs, or inside the file, that leads nowhere. */
function brokenLinks(path: string, ownName?: string): string[] {
  const text = read(path)
  const shown = relative(ROOT, path)
  const problems: string[] = []
  for (const { address, number } of linksOf(text)) {
    if (address.startsWith("#")) {
      const anchor = address.slice(1)
      if (!headingIds(text).includes(anchor))
        problems.push(
          `${shown}:${number} links to #${anchor}, a heading it does not have`
        )
      continue
    }
    const target = docsTarget(address, path)
    if (target === undefined) continue
    const page = pageText(target.page)
    if (page === undefined) {
      problems.push(
        `${shown}:${number} links to ${address}, a page that does not exist`
      )
      continue
    }
    if (
      target.anchor !== undefined &&
      !headingIds(page).includes(target.anchor)
    )
      problems.push(
        `${shown}:${number} links to ${address}, a heading /docs/${target.page} does not have`
      )
    if (ownName !== undefined && target.page === ownName)
      problems.push(
        `${shown}:${number} links to its own page as ${address}; write #${target.anchor ?? ""}`
      )
  }
  return problems
}

describe("the pages of the docs", () => {
  test("no page is longer than 500 lines", () => {
    const long = pageFiles
      .map((name) => ({
        name,
        lines: read(join(PAGES, `${name}.mdx`)).split("\n").length - 1,
      }))
      .filter(({ lines }) => lines > 500)
      .map(({ name, lines }) => `${name}.mdx has ${lines} lines`)
    expect(long).toEqual([])
  })

  test("meta.json gives the contract's tree, in three groups", () => {
    const meta = JSON.parse(read(join(PAGES, "meta.json")))
    expect(meta).toEqual(META)
    const named = META.pages.filter((entry) => !entry.startsWith("---"))
    expect(named).toEqual(CONTRACT.map(([file]) => file))
  })

  test("every page meta.json names exists, with the contract's title", () => {
    const problems = CONTRACT.flatMap(([file, title]) => {
      const text = pageText(file)
      if (text === undefined) return [`${file}.mdx does not exist`]
      const has = frontMatter(text, "title")
      return has === title
        ? []
        : [`${file}.mdx has the title "${has}", not "${title}"`]
    })
    expect(problems).toEqual([])
  })

  test("every page is in meta.json, and no other file is in the folder", () => {
    const named = CONTRACT.map(([file]) => file)
    const files = readdirSync(PAGES).filter(
      (file) =>
        file !== "meta.json" && !named.includes(file.replace(/\.mdx$/, ""))
    )
    expect(files.map((file) => `${file} is not named in meta.json`)).toEqual([])
  })

  test("every link in the pages and the READMEs leads to a page and a heading that exist", () => {
    const problems = [
      ...pageFiles.flatMap((name) =>
        brokenLinks(join(PAGES, `${name}.mdx`), name)
      ),
      ...READMES.flatMap((path) => brokenLinks(join(ROOT, path))),
    ]
    expect(problems).toEqual([])
  })

  test("no page, no README and not the landing page names the desktop app", () => {
    const files = [
      ...pageFiles.map((name) => join(PAGES, `${name}.mdx`)),
      ...READMES.map((path) => join(ROOT, path)),
      join(WEB, "modules/landing/content/index.ts"),
    ]
    const found = files.flatMap((path) =>
      read(path)
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => /desktop|electrobun|apps\/desktop/i.test(line))
        .map(
          ({ line, number }) =>
            `${relative(ROOT, path)}:${number}: ${line.trim()}`
        )
    )
    expect(found).toEqual([])
  })

  test("every page about the CLI, the runner or the core library opens with the warning", () => {
    const missing = CONTRACT.map(([file]) => file)
      .filter((file) => !WITHOUT_CALLOUT.includes(file))
      .filter((file) => {
        const text = pageText(file)
        if (text === undefined) return true
        const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").trimStart()
        return !body.startsWith(
          '<Callout type="warn" title="Pre-alpha and unaudited">'
        )
      })
      .map((file) => `${file}.mdx does not open with "Pre-alpha and unaudited"`)
    expect(missing).toEqual([])
  })
})

describe("the move list", () => {
  /** The rows of the table whose header is `| Old heading | Level | New page | New heading |`. */
  function rows(): string[][] {
    const lines = read(MOVE_LIST).split("\n")
    const header = lines.findIndex((line) =>
      /^\|\s*Old heading\s*\|/.test(line)
    )
    if (header === -1) return []
    const out: string[][] = []
    for (const line of lines.slice(header + 2)) {
      if (!line.startsWith("|")) break
      out.push(
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      )
    }
    return out
  }

  test("has a row for each of the 52 headings of the old page", () => {
    expect(rows().length).toBe(52)
  })

  test("every row points at a page and a heading that exist", () => {
    const problems = rows().flatMap(([old, , page, heading]) => {
      const target = docsTarget(page!, MOVE_LIST)
      const text = target && pageText(target.page)
      if (text === undefined)
        return [`"${old}" moved to ${page}, a page that does not exist`]
      if (heading === "(the page)") return []
      const wanted = headingText(heading!)
      return headingsOf(text).includes(wanted)
        ? []
        : [
            `"${old}" moved to "${heading}" on ${page}, a heading it does not have`,
          ]
    })
    expect(problems).toEqual([])
  })
})

describe("the pages and the stored screens", () => {
  const stored = storedScreenNames()
  const shown = pageFiles.flatMap((name) =>
    [
      ...read(join(PAGES, `${name}.mdx`)).matchAll(
        /<Screen\s+[^>]*name="([^"]+)"/g
      ),
    ].map((match) => ({ page: name, screen: match[1]! }))
  )

  test("every screen a page shows has a stored file", () => {
    expect(
      shown
        .filter(({ screen }) => !stored.includes(screen))
        .map(
          ({ page, screen }) =>
            `${page}.mdx shows ${screen}, which has no stored file`
        )
    ).toEqual([])
  })

  test("every stored screen is shown by a page or by the README", () => {
    const readme = read(join(ROOT, "README.md"))
    const unused = stored.filter(
      (screen) =>
        !shown.some((use) => use.screen === screen) &&
        !readme.includes(`.github/assets/screen-${screen}.svg`)
    )
    expect(
      unused.map(
        (screen) => `${screen} is shown by no page and not by the README`
      )
    ).toEqual([])
  })
})
