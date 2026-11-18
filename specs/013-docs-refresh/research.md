# Research: README and docs refresh

Facts checked in the repository on 2026-11-18, and the decisions that follow.

## 1. How a screen is captured

**Decision**: draw each screen in process with the CLI's own interface and the stand-ins of `apps/cli/test/support`, in a child process started with `FORCE_COLOR=3`.

**Rationale**: the tests already do exactly this. `test/support/terminal.ts` gives `inkUi` a stand-in terminal of a given size and reads the screen back. `test/support/stand-in-server.ts` and `helpers.ts` give a stand-in server, SSH, profile and keychain. `test/support/colour.ts` reads a line back as runs (bold, dim, colour) and notes that Ink fixes how much colour it writes when it is loaded, which is why a child process is needed. Nothing is added to the repository's packages.

**Alternatives considered**: the walkthroughs' way (the compiled program in a pseudo-terminal, read by a terminal emulator written in Python). It is closer to a person's terminal, but it needs Python and an emulator kept in the repository. Rejected for a docs feature.

## 2. How a screen is stored

**Decision**: one JSON file per screen in `apps/web/content/screens/`. Each row of the screen is one line of the file, a list of runs `[look, text]`. Format in `contracts/screens.md`.

**Rationale**: plain text with its colours, readable in a diff row by row, and read by the site and by the SVG maker with `JSON.parse`, so there is no markup to escape and no parser to keep in step in two apps.

**Alternatives considered**: the raw terminal text with its escape codes (unreadable in a diff and on GitHub); a bracket markup as in the walkthrough notes (needs escaping and one parser per app).

## 3. Where the stored screens live

**Decision**: inside `apps/web`.

**Rationale**: the docs' templates list reads `../cli/src/templates/files` from the site's folder, and whether the hosting build carries that folder is still unchecked. Screens do not add a second such reach.

## 4. Values that differ on every run

**Decision**: fixed where the stand-ins allow (a key kept as a fixture gives the same fingerprint every time; example names; the address `203.0.113.10`). Where the program takes the value from a clock or from the stand-in runner's file, the recipe replaces it by a rule, and the rule is written into the stored file under `fixed`.

**Rationale**: SC-005 needs the same result twice in a row, FR-025 forbids changing the program to make that easier, and the reader of the repository must be able to see what was fixed.

## 5. The README's picture

**Decision**: an SVG written by the capture command from the stored Home screen, at `.github/assets/screen-home.svg`. Text is placed cell by cell; box-drawing characters are drawn as lines.

**Rationale**: GitHub shows an SVG as an image and loads no web font into it, so text alone would not line up. Cells and drawn lines look the same in any font. A test regenerates it and compares.

## 6. The docs' page tree, heading ids, and reading a file

Checked on 2026-11-18 in the installed packages: `fumadocs-core` 16.19.0, `fumadocs-mdx` 15.6.1, `fumadocs-ui` (installed as `@fumadocs/base-ui` 16.19.0), `github-slugger` 2.0.0 (a dependency of `fumadocs-core`), `next` 16.4.6. Paths below are under `apps/web/node_modules/`.

**Decision**: one `meta.json` in `apps/web/content/docs/` whose `pages` list holds the three groups as separators, in this exact form:

```json
{
  "pages": [
    "---Start---",
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
    "templates",
    "project-file",
    "doctor",
    "---Reference---",
    "cli",
    "output",
    "storage",
    "runner"
  ]
}
```

### How the installed version reads `meta.json`

- **Which files are meta files.** `apps/web/modules/docs/lib/source.ts` calls `defineDocs({ dir: "content/docs" })` from `fumadocs-mdx/macro` (there is no `source.config.ts`; `next.config.ts` wraps the config with `createMDX()` from `fumadocs-mdx/next`). The meta collection's default pattern is `**/{*.{json,yaml},meta{,.*}.{js,ts}}` (`fumadocs-mdx/dist/build-TiTOkhq4.js`, line 16): every `.json` file under `content/docs` is read as a meta file. So no other `.json` may live in `content/docs`; the screens live in `content/screens`, outside it.
- **The fields.** `metaSchema` in `fumadocs-core/dist/source/schema.js`: `title`, `pages` (list of strings), `pagesIndex`, `description`, `root`, `defaultOpen`, `collapsible`, `icon`, `staticParams`, all optional. Only `pages` is needed here.
- **What an entry of `pages` means** (`createPageTreeBuilder` in `fumadocs-core/dist/dynamic-BOCEF-LU.js`, lines 374 to 630):
  - `---Name---` is a separator with that name; `---[Icon]Name---` adds an icon; `---` alone is a separator with no name. The pattern is `/^---(?:\[(?<icon>[^\]]+)])?(?<name>.+)---|^---$/`. Spaces inside the name are kept ("Using zekno").
  - A plain entry is a file or folder path relative to the folder, without the extension (`"quick-start"` is `quick-start.mdx`).
  - `"..."` (or `"z...a"`, reversed) is every remaining file; `"!name"` leaves one out; `"...folder"` pulls a folder's items up; `[Text](url)` is a link.
  - The list above has no `"..."`, so a page that is not named is not in the sidebar. The builder puts such pages into a separate `fallback` tree (`root()`, line 622); they are still built and reachable by address. The page test must check that every page is named.
- **The introduction.** For the root folder, the index page is not taken automatically (`indexName` is `undefined` when `isGlobalRoot`, line 494), so `index` must be named in `pages`, where it becomes an ordinary item with the address `/docs`. That is why it is listed under "Start".
- **The sidebar.** The notebook layout renders a node of type `separator` with `SidebarSeparator` (`fumadocs-ui/dist/components/sidebar/page-tree.js`, `PageTreeNode`; the notebook's own slot is in `fumadocs-ui/dist/layouts/notebook/slots/sidebar.js`, line 68). A page's name in the sidebar is its front matter `title` (`buildFile`, line 440).

### How a heading gets its id

- **Plugin and slugger.** `fumadocs-mdx`'s default MDX preset (`fumadocs-mdx/dist/preset-CUfyGsn3.js`, line 18) runs `remarkHeading` from `fumadocs-core/mdx-plugins` (`fumadocs-core/dist/mdx-plugins/remark-heading.js`). With no `slug` option (the site gives none) it uses `new Slugger()` from `github-slugger` 2.0.0, one slugger per page, reset for each file. Every heading of the MDX body counts, at any level; the page's front matter `title` is not a heading of the body and is not slugged.
- **The text that is slugged** is `flattenNode(heading)` (`fumadocs-core/dist/utils-DfA1qEJN.js`, line 18): the `value` of every text node and inline code node, joined, with no markup. So backticks never reach the slugger: `` ## `zekno settings` `` gives the text `zekno settings`. Emphasis and links give their words.
- **The slug** (`github-slugger/index.js`, `slug`): lower-cased, then every character matched by its `regex.js` removed, then each space turned into `-`. Kept: letters (including accented ones), digits, `-`, `_` and spaces. Removed: all other ASCII punctuation, ``!"#$%&'()*+,./:;<=>?@[\]^`{|}~``, and symbols such as `—` and `×`. Spaces are not collapsed and hyphens are not merged, so what stood between two spaces leaves two hyphens.
- **A repeated heading** on the same page gets `-1`, then `-2`, and so on: the first `Keys` is `keys`, the second `keys-1`, the third `keys-2`.
- **A custom id**: a heading ending in `[#my-id]` takes `my-id` as is, and that text is removed from the heading (`headingIdRegex` in `fumadocs-core/dist/heading-id-DV5jeAL8.js`). No page uses this today.
- **Examples, run against the installed slugger**: `The app` → `the-app`; `zekno server add` → `zekno-server-add`; `` `zekno settings` `` → `zekno-settings`; `Exit status, and output` → `exit-status-and-output`; `` `--json` and `--plain` `` → `--json-and---plain`; `Docker & Compose` → `docker--compose`; `zekno.app.json` → `zeknoappjson`; `Keys`, `Keys`, `Keys` → `keys`, `keys-1`, `keys-2`.
- **For the page test.** `github-slugger` is not named in `apps/web/package.json` and cannot be imported from `apps/web` (it is only inside `fumadocs-core`'s own folder). The same slugger is reachable through a package the site does name: `createHeadingIds` from `fumadocs-core/mdx-plugins/remark-heading.runtime` builds its slugs with a fresh `github-slugger`. Tried from `apps/web` with bun:

  ```ts
  import { createHeadingIds } from "fumadocs-core/mdx-plugins/remark-heading.runtime"
  const texts = ["The app", "Keys", "Keys", "--json and --plain", "zekno.app.json"]
  createHeadingIds((_props, slug) => texts.map((text) => slug([text])))({})
  // [ "the-app", "keys", "keys-1", "--json-and---plain", "zeknoappjson" ]
  ```

  It trims the text before slugging; the test still has to take each heading's text without its markup (backticks, `*`, link brackets), as `flattenNode` does, and skip headings inside code fences.

### MDX components

`apps/web/modules/docs/components/mdx.tsx` returns `defaultMdxComponents` from `fumadocs-ui/mdx` with the site's own components added (`TemplateList`, now `Screen`). The docs page passes them to the compiled page as `components` (`app/(docs)/docs/[[...slug]]/page.tsx`), so a page uses `<Screen name="home" />` without an import.

### How a server component reads a file

Next's installed guide, `next/dist/docs/01-app/01-getting-started/08-caching.md`, "Predictable values": module imports, synchronous I/O such as `fs.readFileSync`, and pure computations give the same result every time, so a component that uses only these is prerendered automatically and its output is part of the static HTML. An `await readFile()` inside a component is treated as uncached data (it needs `use cache` or a `<Suspense>` boundary); a read that does not depend on the request can also be done once at module scope. The guide's own example of a path is `join(process.cwd(), "assets/…")` (`03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`). The site already does this for the templates (`modules/docs/lib/templates.ts`, `join(process.cwd(), "../cli/src/templates/files")`). The screen frame reads `join(process.cwd(), "content/screens/<name>.json")` with `readFileSync` while it renders: a missing or unsound file throws during the prerender of the page that shows it, which stops the build with the screen's name, and no other route.

**What differs from what this section said before**: nothing in the decision. Added: separators are written `---Name---` inside `pages`; `index` must be named; any `.json` under `content/docs` is read as a meta file; the source is set up in `modules/docs/lib/source.ts` with `fumadocs-mdx/macro`, not in a `source.config.ts`.

## 7. Addresses of the docs printed by the programs

**Fact**: `apps/cli/src`, `apps/runner/src` and `packages/core/src` print no address of the docs. FR-014's second half has nothing to check today; the page test still checks every link inside the docs and the READMEs.

## 8. The test that holds the docs and the CLI in step

**Facts**: `apps/cli/test/docs/docs.test.ts` reads the help and two contracts, and checks two files: the CLI's README and `cli.mdx`. For each it checks (a) every command, flag and key is named, (b) every command it names exists with the flags given, (c) every key in a key table exists.

**Decision**: (a) is checked over all pages of the docs taken together. (b) and (c) are checked for each page of the docs, and for the CLI's README and the root README. The CLI's README no longer has to name every command.

## 9. Where the desktop app is named today

`README.md` (14 lines), `apps/web/content/docs/index.mdx` (5 lines), the landing page's content (6 lines, outside this feature). Nowhere else outside `specs/`. Each line and its replacement: `contracts/readme.md`.
