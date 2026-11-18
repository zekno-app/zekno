# Checking the README and docs refresh

How to see that the feature does what the spec says. Nothing here starts the website or reaches a server.

## The checks

From the repository's root:

```sh
bun run typecheck --force
bun run lint --force
bun run test --force
```

In `apps/cli`:

```sh
bunx prettier --check "**/*.{ts,tsx}"
bun run screens --check
```

## What to look for

| Spec | How to see it |
|---|---|
| SC-003, no page over 500 lines | `wc -l apps/web/content/docs/*.mdx`; the page test |
| SC-004, the CLI's README under 250 lines | `wc -l apps/cli/README.md` |
| SC-005, a screen is the same twice | `bun run screens && git status --short` shows nothing, twice |
| US4 scenario 2, a changed sentence names its screen | Change a word the app prints on Home in a scratch copy of the working tree, run `bun test test/screens`: it fails and says `home`. Undo the change |
| FR-015, the docs test still bites | Take one flag out of a page, run `bun test test/docs`: it fails and names the flag. Undo |
| SC-006, every old heading is on the move list | `git show dev:apps/web/content/docs/cli.mdx` gives the old headings; each is a row of `move-list.md` |
| FR-011, nothing lost | The comparison of the old page's lines with the new pages, in the tasks: every line is found, reworded or dropped with a reason |
| FR-028, no desktop app | `grep -ri desktop README.md apps/*/README.md apps/web/content` finds nothing |
| SC-008, nothing of the programs changed | `git diff dev --stat -- apps/cli/src apps/runner packages/core apps/cli/e2e.config.ts apps/cli/tests` is empty |

## What the maintainer looks at

The running site: the three groups in the sidebar, a page with a frame at a wide and at a narrow window, the README on GitHub with its picture in the dark and in the light theme.
