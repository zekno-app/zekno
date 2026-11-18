# Contract: the two READMEs

## The root README, section by section

Approved on the boards `ReadmeTop` and `ReadmeOutline`.

| Section | What it holds | Compared with today |
|---|---|---|
| Title, promise, badges | As today, plus a badge "audit: none yet" | Kept, one badge added |
| Warning | "Pre-alpha and unaudited. The command-line tool and the server runner work today, for one developer, deploying directly over SSH. The hosted service is not built yet. Do not use Zekno for anything you could not afford to lose." | Rewritten. "Being scaffolded" goes |
| One screen | The app's Home, `.github/assets/screen-home.svg`, with its description as alternative text | New |
| What works today | A table: deploy a Compose app; secrets sealed on your machine; describe the app by settings; add a database; see it, read logs, roll back. Each with its command and a link to its page. Then one line: "Not built yet: teammates, the hosted service, domains with HTTPS, building from source. See the roadmap." | New |
| Try it | Three commands (clone and install, compile, `zekno deploy`) and a link to the quick start. Says it is built from this repository with Bun 1.4.4 | New |
| Overview | The table of properties | Kept, without the desktop app |
| Why | As today | Kept |
| How it works | First "Today: your machine talks to your server": a diagram of the CLI, SSH, the runner and your containers, and three sentences. Then "Planned: a hosted service in the middle, holding nothing it can open": today's two diagrams and the step-by-step, with the CLI as the program on your machine | The first part is new. The second is today's "Architecture", labelled planned |
| Security model | Trust boundaries, the three threat tables, the open-source boundary, the eight design rules, reporting | Kept whole. Only the desktop app's sentences change, as listed below |
| Repository | One or two sentences per part and a link to its page | Shorter. The long status cells go to the docs |
| Develop | Install, the commands, how the website is organised, adding UI components | Kept (today's "Getting started", without presenting the website as the product) |
| Roadmap | What is built, ticked. Then, in the road map's order: domains and HTTPS, building from source, creating a server, installing with one command, deploys from CI, the Railway importer. Later: the hosted service and teammates, an external audit | Rewritten in the road map's order |
| Contributing, License | As today | Kept |

Rules:

- Nothing is said to work that does not. The planned part is under a heading that says "Planned".
- Every row of every table of the security model stays, and every design rule (FR-006).
- "runner", never "agent". The promise line stays as it is.
- Links to the docs point at pages of `contracts/pages.md`, as full addresses of the published site where the README uses them today, and they are checked by the page test.
- Mermaid diagrams stay Mermaid. The new diagram of today's path is Mermaid too.

## The desktop app's sentences

Every line that names it today, and what replaces it. In the planned design the program on the developer's machine is the CLI, which holds the key today.

| Today (root README) | Becomes |
|---|---|
| "a managed platform (a desktop app, teammates with roles, deploy history)" | "a managed platform (one command to deploy, teammates with roles, deploy history)" |
| Diagram box "Desktop app: Holds the team signing key, Encrypts secrets, Signs each deploy" | "zekno, the CLI: Holds the team signing key, Encrypts secrets, Signs each deploy" |
| "If Zekno is unavailable, the desktop app can deploy to the runner directly." | "If Zekno is unavailable, the CLI deploys to the runner directly, over SSH, as it does today." |
| Sequence diagram: participant "Desktop app"; "Set secrets, press Deploy" | Participant "zekno CLI"; "Set secrets, run zekno deploy" |
| "The desktop app encrypts secrets for the server's public key and signs the deploy manifest with the team key." | "The CLI encrypts secrets for the server's public key and signs the deploy manifest with the team key." |
| Trust boundaries row "Desktop app, A team member's machine, Team signing key, Yes, Yes" | "Command-line tool (`zekno`), A team member's machine, Team signing key, Yes, Yes" |
| Threat row "A Zekno app or runner release is tampered with" | "A Zekno release (the CLI or the runner) is tampered with". The rest of the row stays |
| Open-source boundary row "Desktop app, `apps/desktop`, Open" | Removed. The CLI's row is already there |
| Rule 1: "Private keys stay in the desktop app's main process. The UI asks the main process to encrypt or sign over typed RPC and never sees a key." | "**Private keys stay out of the interface.** The code that draws screens asks a separate part of the program to encrypt or sign, and never holds a key." To be worded only as far as `apps/cli/test/layers/layers.test.ts` and the code show it to be true today; if they do not, the rule is kept as a rule for any interface and says so |
| Rule 3: "The app, the runner and the website reach the control plane only through the public protocol" | "The CLI, the runner and the website reach the control plane only through the public protocol" |
| Rule 6: "Releases and updates are signed with an offline key, and the app verifies that signature itself before applying an update. This is the rule for the planned desktop app. Runner releases are not signed yet: …" | "**Releases and updates are signed with an offline key**, and whatever installs one verifies that signature itself first. This rule is not met yet: runner releases are not signed. A server installs a runner only when its checksum equals the one the CLI holds, recorded after a second build (see the threat table above)." |
| Rule 8: "The Electrobun version is pinned, and `packages/core` stays free of Electrobun code." | "**`packages/core` holds no interface or framework code**, so everything that encrypts or verifies does it with the same small library." |
| Repository row "`apps/desktop`, Desktop app (Electrobun…), Planned" | Removed |
| "The desktop app and the runner both depend on it" | "The CLI and the runner both depend on it" |
| "It never handles keys or secret values; those stay in the desktop app." | "It never handles keys or secret values; those stay on your machine." |
| Tech stack row "Desktop app (planned)" | Removed |
| Roadmap "Desktop app: connect a server, set secrets, deploy, roll back, logs" | Removed |

| Today (docs introduction) | Becomes |
|---|---|
| "The desktop …" in the callout | The callout says what works today and that the hosted service is not built |
| "a managed platform (a desktop app, …)" | As in the README |
| Trust table row "Desktop app" | As in the README |
| "The desktop app encrypts each secret …" | "`zekno` encrypts each secret for your server's public key before anything leaves your machine." |
| "What exists today" row "Desktop app (`apps/desktop`), Planned" | Removed |

Any other "the app" that meant the desktop program is reworded the same way. "The terminal app", "the full-screen app" and "your app" (what is deployed) stay.

Rules 1, 6 and 8 and the two table rows are security-model wording. Their final text is reported to the maintainer with the feature.

## The CLI's README

`apps/cli/README.md`, under 250 lines (SC-004):

| Section | What it holds | Compared with today |
|---|---|---|
| What zekno is | Five lines, the pre-alpha warning, and links to the docs: quick start, commands | Short |
| Build from source | As today | Kept |
| Develop | As today | Kept |
| End-to-end tests | As today | Kept |
| Screens for the docs | `bun run screens`, `--check`, where the files are, how to add a screen | New |

Everything else it holds today is in the docs after the split and is removed from it (FR-023). Before removing a section, it is compared with the docs' text: a sentence that is in the README and not in the docs is moved to the docs' page for that subject and noted in the move list under "From the CLI's README".
