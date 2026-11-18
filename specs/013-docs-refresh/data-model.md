# Data model: README and docs refresh

This feature stores no data of the product. Its "entities" are files of the repository.

| Entity | File | Fields | Rules |
|---|---|---|---|
| Page | `apps/web/content/docs/<file>.mdx` | `title`, `description` (front matter), headings, body | At most 500 lines. In `meta.json` exactly once. Anchors come from headings |
| Page tree | `apps/web/content/docs/meta.json` | Three groups, each a list of pages in order | Names every page; names no page that is missing |
| Screen | `apps/web/content/screens/<name>.json` | `name`, `title`, `command`, `columns`, `rows`, `alt`, `fixed`, `lines` | Format in [contracts/screens.md](contracts/screens.md). Written only by the capture command |
| Recipe | `apps/cli/test/screens/recipes/<name>.ts` | How one screen is drawn with the stand-ins | One per screen. Same output on every run |
| Picture | `.github/assets/screen-home.svg` | The Home screen as an SVG | Written only by the capture command, from `home.json` |
| Move list | `specs/013-docs-refresh/move-list.md` | Old heading, level, new page, new heading; reworded; dropped | One row per heading of the old page. Every target exists |

A screen moves through two states: **stored** (the file in the repository) and **drawn** (what the program gives now). The test compares them; `bun run screens` makes the stored one equal to the drawn one.
