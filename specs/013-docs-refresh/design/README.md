# README and docs refresh: the boards

Six boards, proposed on 2026-11-18 and **not approved yet**. They are the row "README and docs
refresh (spec 013)" of the design canvas (https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW).
Nothing in the README or the docs is rewritten until the maintainer approves them.

| Board | Shows |
|---|---|
| `DocsTree.dc.html` | Today's four pages beside the proposed seventeen, in three groups, with what each holds, where its text comes from and about how long it is |
| `DocsQuickStart.dc.html` | The new quick start page in the site's layout, with two real screens: a first deploy from nothing, and Home |
| `DocsCommandPage.dc.html` | A command page after the split: Templates (`zekno add`) |
| `DocsFrame.dc.html` | How a screen is shown: a command's output, a screen of the app, a phone, and what a frame is and is not |
| `ReadmeTop.dc.html` | The top of the root README as GitHub shows it: the warning, one screen, what works today, try it, today's path drawn before the planned design |
| `ReadmeOutline.dc.html` | Every section of the root README and of the CLI's README: kept, new, shorter, or moved to the docs |

## What is real in them

The three screens are captures of the real program from the walkthroughs of features 006, 010
and 012, turned into boards by a script. Nothing in them was edited by hand. The site's layout,
its colours and the GitHub page around them are drawn.

## Known before building

- The first-deploy capture says `Runner installed  1 MB`, because the walkthrough used a stand-in
  runner. The captures made for the docs must not show a size or a time that a real run would
  never show. The plan decides how.
- The line counts on `DocsTree` are estimates from today's headings.
- The roadmap's order on `ReadmeOutline` is the order of the road map, which the maintainer has
  not confirmed yet.
- The README's picture of Home is a file made from the same capture as the docs' frame. Which
  kind of file is a choice for the plan, to agree with the maintainer.
