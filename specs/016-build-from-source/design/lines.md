# The words of feature 016, build from source

**Status**: proposed, not approved. Every line here is a draft for the boards. The maintainer approves the words and the look on the boards before anything is built (spec FR-092). Where a board and this file differ once the boards exist, the board is the later one.

**Example values**, used everywhere in this file and on the boards:

- The app `shop` on the server `prod-1` (203.0.113.7, Docker Engine 29.8.2, x86-64, 4 GB of memory), signed by Ada. Another app, `blog`, on the same server.
- `shop` has two services built from one folder with one Dockerfile: `web`, on port 3000, and `worker`, with no port and the start command `bun run worker`.
- The folder `~/code/shop`, a git repository. Its `Dockerfile` is at its top: `FROM node:22-slim`, `ARG API_URL`, `EXPOSE 3000`, and `RUN npm ci` on line 9.
- What it sends: 1,204 files, 18 MB. Largest folders: `src` 9 MB, `public` 6 MB, `prisma` 1 MB. Left out: `node_modules` (612 MB) and `.next` (98 MB) by `.dockerignore`; `.git`, `.env` and `.env.local` by zekno's own rules. A folder that is too large would send 734 MB.
- Plain variables of `web`: `API_URL=https://api.shop.example.com`, which the Dockerfile declares; `NODE_ENV=production`, which it does not; and `PORT=3000`, which zekno sets (FR-072a) and the Dockerfile does not declare either. So the build of `web` reads `API_URL` and no other plain variable. Secrets: `DATABASE_URL` and `SESSION_KEY`, read by the running app; `NPM_TOKEN`, named for the build (step 1b).
- `shop` runs deploy 6. The new deploy is 7.
- Runner 0.1.1 today, 0.1.2-dev.1 after step 1, 0.1.2-dev.2 after step 2. Railpack 0.43.1, a file of 24 MB (a stand-in size). Node 22.23.5, then 22.23.6.
- Sizes as zekno prints them today (`shared/sizes.ts`, `ops/doctor.ts`): decimal MB and GB. 512 MiB is 537 MB; 2 GiB is 2 GB.

The spec's drafts say `prod`. This file says `prod-1`, as the docs' stored captures (`apps/web/content/screens`) and the boards of features 014 and 015 do.

**Habits kept** from the lines that exist and from the models (`specs/014-deploy-v2/design/lines.md`, `specs/015-domains-https/design/lines.md`):

- The first sentence says what happened, the second what to do.
- "Nothing was signed." ends a stop before signing. "Nothing of it ran." follows a runner's refusal, as 014's R-lines do.
- A command to run is in backticks. A terminal and the app drop the backticks; plain output prints them.
- A mark before every state (`✔`, `!`, `✖`, `●`, `○`, the spinner), never colour alone.
- A refusal's first sentence is drawn bold and fits one line of 100 columns, its mark included.
- A yes-or-no question starts with the question, drawn bold, then what it means, then `(y/N)`. A list question leaves `✔ <word>  <answer>` behind (015, A7).
- The same word for the same thing: "the build of web", "sends" and "sent" for the code, "left out" for files not sent, "kept" for an image the server keeps, "reserved" for a name only zekno may use, "saved" for a build's output on this machine, "covers" for what a signature protects from change, "a fresh build", "build secrets", "plain variables", "the builder" for what builds on the server, "URL" for a web address.
- A question declined or left says today's `✖ Nothing was done.` (`cli/errors.ts:34`), or, once this run already made something, today's `Nothing more was done. …` (`NOTHING_MORE`, `asking/first-deploy.ts:101`). "Nothing was signed." is kept for a stop.
- Words a person from Railway, Render or Heroku knows. Docker's own words (`ARG`, `ADD`, stage, digest) only where there is no plainer one.

**How to read it.** Each table gives: the number; when the line shows; the line (for a refusal, its first sentence and then the rest); the requirement or scenario of the spec that asks for it (FR-nnn, or US n sc m for User Story n, scenario m); and its state: **new**, **changed** (with today's exact line and its file), or **kept** (today's, unchanged). Layout is only named here where a row needs it; the boards draw it.

**Steps.** A row ships in step 1 unless it is marked **(step 1b)** or **(step 2)**, or a piece of it is. Parts H and I are wholly step 1b and step 2. Where a line differs by step, the row gives each form.

**Options A and B.** Where the two readings of this file pulled one line opposite ways, the row keeps both wordings, and a choice below names them with a recommendation.

**Where a line shows.** As in 014 and 015, each sentence is said the same way in three places:

- `zekno deploy`, `zekno rollback` and the other single commands at a terminal: a refusal with `✖`, its first sentence bold and the rest dim under it; a warning with `!`; a note dim and set in by two columns.
- With no terminal, or with `--json`: one plain line on standard error. Standard output keeps only today's result line, or the one JSON object (FR-017, US2 sc8).
- The full-screen app (part J): a refusal as the result line in the error colour; a warning as a notice in the warning colour.

## A. The first deploy in a folder with a Dockerfile and no settings file

At a terminal, in a folder with a `Dockerfile` at its top and neither `zekno.app.json` nor `compose.yaml`. It comes first, where today's question "Deploy from which file?" is asked, before the opening line and the questions about the key, the server and the app (FR-002). The block above the question is drawn as `zekno add` draws its summary: a title line per thing, its rows under it (choice A-a below).

| # | When | Line | Asks | State |
|---|---|---|---|---|
| A1 | First line, a note (dim, set in by two) | `This folder has a Dockerfile, and no zekno.app.json or compose.yaml.` | FR-002 | new |
| A2 | The block of what would be sent | The same title and rows as B1 to B6, with `your server` in place of `prod-1`: `Sends this folder to your server` | FR-002, FR-017 | new |
| A3 | The block of the settings file it would write: its title, then the rows `zekno settings` shows for it (G1) | `Writes zekno.app.json`, then `web` and its rows: `Source  root  .` · `Build  builder  Dockerfile` · `dockerfile  Dockerfile` · `Networking  port  3000, not published` | FR-002a, US1 sc1 | new |
| A4 | Under A3, when the service has a port (FR-072a) | `web is given PORT=3000, to match its port.` (dim) | FR-072a | new |
| A5 | The block of the `.dockerignore` it proposes, only when the folder has none: the title, a dim detail, then the file's lines in a dim box | `Writes .dockerignore` and dim `drawn from .gitignore, plus dependency folders`; the lines: `node_modules`, `.next`, `.venv` | FR-002b, US1 sc3 | new |
| A6 | The first line of the proposed `.dockerignore` | `# Written by zekno deploy. What is listed here is not sent to the server.` | FR-002b | new |
| A7 | The question (a list) | `? Build this folder on your server? This writes zekno.app.json and .dockerignore.` With a `.dockerignore` already there: `? Build this folder on your server? This writes zekno.app.json.` | FR-002, US1 sc1 | new |
| A8 | Its answers, label then dim detail, when the Dockerfile names a port | `Build, port 3000` `the port the Dockerfile names` · `Build, another port` · `Build, no port` `for a worker that nothing reaches` · `Don't build` `nothing is written` | FR-002a | new |
| A9 | Its answers when the Dockerfile names no port | `Build, with a port` · `Build, no port` `for a worker that nothing reaches` · `Don't build` `nothing is written` | FR-002a | new |
| A10 | What the answer leaves behind | `✔ Build  port 3000`, `✔ Build  port 8080`, or `✔ Build  no port` | FR-002a | new |
| A11 | `another port` or `with a port`: the port asked | `? Port ›`, with today's rule when refused: `That is not a port.` then `Use a port from 1 to 65535.` (`settings/words.ts`, `settingWords("port")`) | FR-002a | kept words |
| A12 | After the answer, the files written; the deploy goes on with the opening line | `✔ Written zekno.app.json and .dockerignore`, or `✔ Written zekno.app.json` | FR-002 | new, in IN3's pattern (`✔ Written zekno.app.json  Run zekno deploy to use it.`, `settings/words.ts:408`) |
| A13 | `Don't build`, Esc or Ctrl-C: nothing is written (choice A-c) | (a), as FR-002 says, today's sentence for a folder with no Compose file: ``✖ No Compose file at /Users/ada/code/shop/compose.yaml.`` then ``Point to one with `-f <file>`.`` · (b), recommended, as every other question declined: `✖ Nothing was done.` | FR-002, US1 sc2 | (a) kept (`project/compose-read.ts:79`); (b) kept (`cli/errors.ts:34`), and FR-002 changes |
| A14 | Several Dockerfiles: a `Dockerfile` at the top beside `Dockerfile.dev`, or beside `api/Dockerfile` in a sub-folder that is sent. Asked before A1 to A9, which then name the one chosen | `? Build from which Dockerfile?`, rows `Dockerfile` `names port 3000` · `Dockerfile.dev` `names port 5173` · `api/Dockerfile` `names port 8080` (a row with no port has no detail) | FR-004, US1 sc6 | new, in DP1's pattern (`settings/words.ts:433`) |
| A15 | What A14 leaves behind; the choice is written as `build.dockerfile` | `✔ Dockerfile  Dockerfile.dev` | FR-004 | new |
| A16 | No terminal, or `--json`, in the same folder: nothing is written, fetched or run | Today's sentence for a folder with no Compose file (A13's form (a)), on standard error, exit status 1, whatever choice A-c decides | FR-003, US1 sc5 | kept |
| A17 | A folder with both `zekno.app.json` and `compose.yaml`, a Dockerfile in it or not: today's question, unchanged; a Dockerfile changes nothing | `? Deploy from which file?`, rows `zekno.app.json` `your settings` · `compose.yaml` `a Compose file written by hand`; left behind `✔ From  zekno.app.json` | FR-005 | kept (DP1, `settings/words.ts:433`) |
| A18 | `zekno settings init` in a folder with a Dockerfile and no settings file: the same question with `This writes zekno.app.json.`, and the last answer replaced | The last row is `Run an image instead` `asks for its name`, which goes on to today's `? Image ›` | FR-011, US7 sc5 | new; see G25 |

## B. The summary before signing

Shown at a terminal for every deploy that builds, before the deploy panel, where 015's `✔ shop.example.com points to prod-1` stands. The block has a title line and rows; warnings follow it with `!`; notes follow dim. Choice B-a below decides which lines show at every deploy.

| # | When | Line | Asks | State |
|---|---|---|---|---|
| B1 | The title | `Sends this folder to prod-1` and dim `sealed, so only prod-1 can open it` | FR-017, FR-026 | new |
| B2 | The folder sent is above the settings file (a monorepo, `source.root` set) | `Sends ../.. to prod-1` and dim `the top of this git repository, sealed, so only prod-1 can open it` | FR-009, point 5 | new |
| B3 | The size row | `files     1,204 files, 18 MB` | FR-017 | new |
| B4 | The largest folders, three at most | `largest   src 9 MB, public 6 MB, prisma 1 MB` | FR-017 | new |
| B5 | What was left out, one rule a line, the rule dim in brackets as `zekno secret import` draws its groups (`commands/secret.ts:136`) | `left out  node_modules, .next (.dockerignore)` · `.git (zekno's own rule)` · `.env, .env.local (they look like they hold secrets)` · `assets/shared (a link that leads out of this folder)` | FR-014, FR-015, FR-017, US2 sc1, sc6 | new |
| B6 | A file on the list of secret-looking files that the settings name, and that you agreed to on this machine | `also sent  certs/server.key (zekno.app.json names it, and you agreed on this machine)` | FR-015a, FR-017, US2 sc4 | new |
| B7 | A note after the block, for each `.env` or `.env.*` left out | ``.env was left out: it looks like it holds secrets. To give its values to the app, run `zekno secret import .env`.`` | FR-015, US2 sc3 | new (spec's draft) |
| B8 | A note for any other secret-looking file left out | ``certs/server.key was left out: it looks like a private key. To send it, run `zekno settings set web.include certs/server.key`.`` | FR-015 | new; the setting is choice G-b |
| B9 | Which builds, one row a build. Two services with one recipe share a row | `builds    web and worker, one build with Dockerfile` · two recipes: `web with Dockerfile, worker with docker/worker.Dockerfile` · (step 2) `web with Railpack 0.43.1` | FR-012, FR-017 | new |
| B10 | What each build reads, names only (FR-072b) | `reads     API_URL (a plain variable)` · (step 1b) `NPM_TOKEN (a build secret)` · two builds: each row starts with the service, `web: API_URL` | FR-072b, US11 sc1 | new |
| B11 | `PORT`, a note | ``web is given PORT=3000, to match its port. To change both, run `zekno settings set web.port <port>`.`` | FR-072a, point 20 | new |
| B12 | A warning above the warning size (100 MB) | `! This deploy sends 184 MB. Largest: public 120 MB, data 40 MB. To send less, list what the build does not need in .dockerignore.` | FR-018 | new |
| B13 | A warning: the folder is in a git repository and has changes not committed | `! This folder has changes that are not committed yet. They are sent and built too.` | FR-017a, US2 sc9 | new |
| B14 | A warning: a base image named without a digest, one line an image, then a dim line | `! The Dockerfile of web starts from node:22-slim, a tag that can point to another image at any time.` then dim `To pin it, write node:22-slim@sha256:<digest> in its FROM line.` | FR-042a, point 4 | new |
| B15 | A warning: the Dockerfile has a `# syntax=` line | `! prod-1 ignores the # syntax= line of web's Dockerfile. It reads the file with the Dockerfile version built into its Docker.` | FR-034, FR-042a | new |
| B16 | A warning: a plain variable the Dockerfile declares with `ARG` and the build is not given, under a name the builder reads as its own setting | `! The build of web is not given HTTP_PROXY: the builder would read that name as a setting of its own.` | FR-036b, US11 sc4 | new |
| B17 | The same, under a name zekno reserves for itself | `! The build of web is not given DOCKER_HOST: zekno reserves that name for itself.` | FR-036b | new |
| B18 | A warning: the Dockerfile declares with `ARG` a name that is a secret of the app. Step 1, before step 1b ships | `! The build of web is not given SESSION_KEY: it is a secret of shop, and a secret never reaches a build through ARG.` | FR-036e | new |
| B19 | The same, (step 1b): the second sentence says how a build reads one | the B18 sentence, then ``To give it to the build, run `zekno settings set web.build-secrets SESSION_KEY`, and read it in the Dockerfile with RUN --mount=type=secret,id=SESSION_KEY.`` | FR-036e, FR-037 | new |
| B20 | A note: what reaches only the running app (FR-072). (step 2) For a Railpack build, which reads every plain variable, it names the secrets only, without its second sentence | `NODE_ENV, PORT, DATABASE_URL and SESSION_KEY reach only the running app, not the build of web. A build reads a plain variable only when the Dockerfile declares it with ARG.` | FR-072, point 19 | new |
| B21 | A note: what the signature does not cover, for a Dockerfile | `This signature does not cover what the build downloads while it runs, such as base images named by tag and packages.` | FR-072, US4 sc4 | new |
| B22 | A note: the build's network is `none` | `The RUN steps of web's build have no network. The builder still fetches base images, and files that ADD names by URL.` | FR-038 | new |
| B23 | A note: it builds again because a plain variable it reads changed | `API_URL changed, and the build of web reads it, so web is sent and built again.` | FR-072c, US11 sc3 | new (spec's draft) |
| B24 | The first deploy that builds from this folder on this machine, when a settings file exists (one from a cloned repository, say): after the block | `? Send this folder to prod-1 and build it there? zekno asks once for each folder on this machine. (y/N)` | FR-015b, US2 sc5 | new |
| B25 | No to B24, Esc or Ctrl-C | `✖ Nothing was done.` When this run already made the key, a server or a value: ``✖ Nothing more was done. What was set up so far is kept: run `zekno deploy` again to carry on.`` | FR-015b | kept (`cli/errors.ts:34`; `NOTHING_MORE`, `asking/first-deploy.ts:101`) |
| B26 | A file of B6 the first time, at a terminal, after the block | `? Send certs/server.key to prod-1? It looks like a private key, and zekno.app.json names it. (y/N)` For a `.env`: `It looks like it holds secrets` | FR-015a, US2 sc4 | new |
| B27 | No to B26, Esc or Ctrl-C | B25's two forms | FR-015a | kept |
| B28 | The deploy panel's new rows, after `from` (choices B-b, B-c) | The `builds` row. Option A (recommended), B9's words: `builds    web and worker, one build with Dockerfile`. Option B, in the form of the panel's `from` row, the detail dim after two spaces: `builds    web, worker  with Dockerfile`. Then `sends     1,204 files, 18 MB` | FR-017 | new; today's rows are `app`, `server`, `from`, `secrets`, `domains`, `replaces` (`ui/parts/deploy-summary.tsx`) |
| B29 | No terminal: the facts as sentences on standard error, one a line, before anything is signed | `Sends 1,204 files, 18 MB to prod-1. Largest: src 9 MB, public 6 MB, prisma 1 MB.` · with B2: `Sends ../.., the top of this git repository.` · `Left out by .dockerignore: node_modules, .next.` · `Left out by zekno: .git; .env and .env.local, which look like they hold secrets.` · with B6: `Also sent: certs/server.key, which zekno.app.json names and you agreed to on this machine.` · B9: `web and worker are built once, with Dockerfile.` · `The build of web reads API_URL.` · then each warning and note above as its sentence | FR-017, FR-072b, US2 sc8 | new |

## C. Stops before signing

At a terminal the sentence stands alone, as every stop before the panel does today; the app shows its panel with `✖ Checked` (015, part B). Exit status 1, as a fault in the settings (FR-071b).

| # | When | First sentence | Then | Asks | State |
|---|---|---|---|---|---|
| C1 | Over the 512 MiB a deploy can carry | `This deploy would send 734 MB, over the 537 MB a deploy can carry.` | `Largest: node_modules 612 MB, .next 98 MB. List them in .dockerignore, then deploy again. Nothing was signed.` | FR-018, US2 sc2 | new |
| C2 | Over the entry limit (50,000 files and folders) | `This folder holds 61,240 files and folders, over the 50,000 a deploy can carry.` | `Most files: node_modules 58,102, .venv 2,011. List them in .dockerignore, then deploy again. Nothing was signed.` | FR-018, point 22 | new |
| C3 | An empty folder | `This folder has no files to send.` | `Deploy from the folder that holds the code. Nothing was signed.` | Edge cases | new |
| C4 | Every file is left out | `Every file of this folder is left out, so there is nothing to send.` | `Check .dockerignore, then deploy again. Nothing was signed.` | Edge cases | new |
| C5 | A file zekno cannot read | `zekno could not read public/video.mp4 in this folder.` | `Check that you can read it, or list it in .dockerignore. Nothing was signed.` | FR-019 | new |
| C6 | A file that changed while zekno read it | `src/app.ts changed while zekno was reading this folder.` | ``Run `zekno deploy` again. Nothing was signed.`` | FR-019 | new |
| C7 | A name that is not valid UTF-8, holds a control character, or is too long; shown cleaned | `src/caf?.txt cannot be sent: its name is not valid UTF-8.` (or `its name holds a control character`, or `its name is longer than 255 bytes`) | `Rename it, or list it in .dockerignore. Nothing was signed.` | Edge cases | new |
| C8 | A Compose file written by hand in which a service asks Docker to build | `compose.yaml asks Docker to build web.` | ``zekno builds from a settings file only: run `zekno settings init` to start one. Nothing was signed.`` | FR-075, US4 sc2, point 6 | new (spec's draft) |
| C9 | A Compose file written by hand names the space reserved for built images | `compose.yaml names zekno.invalid/shop, a name zekno reserves for the images it builds.` | `Use the image's own name. Nothing was signed.` | FR-077 | new |
| C10 | The Dockerfile names an image in that space: directly, through an `ARG` default or a plain variable, or in a copy from another image | `The Dockerfile of web starts from zekno.invalid/blog, an image built for another app.` | `A build starts only from images in a registry. Nothing was signed.` | FR-042, US4 sc6, US11 sc6 | new |
| C11 | zekno cannot resolve an image name fully | `The Dockerfile of web names an image zekno cannot work out: FROM ${BASE} on line 1.` | ``Give BASE a default in its ARG line, or set it with `zekno settings set web.plain.BASE <image>`. Nothing was signed.`` | FR-042 | new |
| C12 | `ADD` of a web address or a git repository with no checksum | `The Dockerfile of web fetches https://example.com/tool.tar.gz with ADD and no checksum (line 12).` | `Add --checksum=sha256:<hash> to that line. Nothing was signed.` | FR-042a, point 4 | new |
| C13 | `ADD` of an address that names the server itself or a private address, checksum or not | `The Dockerfile of web fetches http://10.0.0.5/setup.sh with ADD, a private address (line 12).` | `A build cannot fetch from the server or its private network. Nothing was signed.` | FR-042a, point 4 | new |
| C14 | More plain variables than a build can carry (32) | `The build of web would read 33 plain variables, over the 32 a build can carry.` | `Remove the ARG lines it does not need, then deploy again. Nothing was signed.` | FR-036c, US11 sc5 | new |
| C15 | A value longer than a build can carry (4 KiB, said in bytes) | `API_URL is 5,120 bytes, over the 4,096 bytes a build can carry for one value.` | `Shorten it, or remove ARG API_URL from the Dockerfile of web. Nothing was signed.` | FR-036c, US11 sc5 | new |
| C16 | More than 64 KiB of plain variables in all for one deploy (said in bytes) | `shop's builds would read 71,680 bytes of plain variables, over the 65,536 a deploy can carry.` | `Remove the ARG lines they do not need, then deploy again. Nothing was signed.` | FR-036c | new |
| C17 | More than 8 builds in one deploy | `shop would build 9 images, over the 8 one deploy can build.` | `Run some services from an image, or build several from one Dockerfile and stage. Nothing was signed.` | Edge cases | new |
| C18 | The Dockerfile has no stage of the name `build.stage` gives (not named by the spec; caught before signing by FR-025) | `The Dockerfile of web has no stage named release.` | ``Its stages are deps, build and runner. Set one with `zekno settings set web.stage <stage>`. Nothing was signed.`` | FR-025 | new, proposed |
| C19 | A named secret-looking file, no terminal, and no earlier yes on this machine | `zekno.app.json names certs/server.key to send, and no one said yes to that on this machine.` | ``Run `zekno deploy` once at a terminal to answer. Nothing was signed.`` | FR-015a, US2 sc4 | new |
| C20 | The file `build.dockerfile` names is not there | `zekno.app.json names Dockerfile.prod, and there is no such file in ~/code/shop.` | ``Set the Dockerfile with `zekno settings set web.dockerfile <path>`. Nothing was signed.`` | FR-009 | new, in SR1's pattern (`settings/words.ts:25`) |
| C21 | `--fresh` on a deploy that builds nothing (choice D-c); exit status 1, as every new refusal of a deploy (FR-071b) | `` `--fresh` asks for a fresh build, and no service of shop is built from source. `` | `Deploy without it.` | FR-021a, FR-071b | new |

Faults of the settings file, said in today's form, `<file> could not be read as settings.` then `<place>: <rule>` (`settings/words.ts:56`). Exit status 1. The names of the settings are choice G-a.

| # | When | Line | Asks | State |
|---|---|---|---|---|
| C22 | `source.root` above the top of the git repository; outside a repository, above the settings file's folder | `zekno.app.json could not be read as settings. web, source.root: use a folder inside the git repository that holds zekno.app.json.` · outside a repository: `zekno.app.json could not be read as settings. web, source.root: use the folder of zekno.app.json or one inside it.` | FR-009, US7 sc2 | new |
| C23 | `source.root` passes through a link that leads out | `zekno.app.json could not be read as settings. web, source.root: it leads outside the repository through a link. zekno does not follow it there.` | FR-009 | new |
| C24 | `build.dockerfile` outside the folder sent, or not relative | `zekno.app.json could not be read as settings. web, build.dockerfile: use a path inside the folder sent, such as Dockerfile.` | FR-009 | new |
| C25 | A service with both an image and a build | `zekno.app.json could not be read as settings. web: set source.image or build, not both.` | FR-006 | new |
| C26 | A service with neither | `zekno.app.json could not be read as settings. web, source.image: a service needs an image or a build, such as ghcr.io/acme/web:1.4.2.` | FR-006 | changed; today SV7: `web, source.image: a service needs an image, such as ghcr.io/acme/web:1.4.2.` (`settings/words.ts:108`). Also said to apps that do not build, with no terminal too: an exception to FR-074 for the maintainer to approve (open point 14) |
| C27 | `build.timeout` out of 1 to 7,200 | `zekno.app.json could not be read as settings. web, build.timeout: use a number of seconds from 1 to 7200.` | FR-010 | new |
| C28 | `build.network` neither value | `zekno.app.json could not be read as settings. web, build.network: use internet or none.` | FR-007 | new |
| C29 | `source.image` names the space reserved for built images | `zekno.app.json could not be read as settings. web, source.image: zekno.invalid is reserved for the images zekno builds.` | FR-077 | new |
| C30 | Today's refusal of a build in a settings file goes | `zekno.app.json sets a build for web.` then `Building from source is not in this version of zekno yet.` | FR-006 | removed (`settings/words.ts:283-286`) |
| C31 | (step 1b) A deploy whose settings name more than 32 build secrets for one build; exit status 1 | `zekno.app.json could not be read as settings. web, build.secrets: at most 32 names.` | FR-037a | new |

The runner's own refusals, in the pattern of 014's R-lines: the runner answers a fixed word, so most name no app. The reason words are drafts for the plan.

| # | Reason (draft) | Sentence | Asks | State |
|---|---|---|---|---|
| R11 | `build_mismatch`: the code, a piece, the recipe, the plan, the builder, a plain variable or a build secret's name does not match what is signed | `What this deploy sent to build does not match what it signed. Nothing of it ran. Run zekno deploy again.` | FR-023, FR-029, FR-049a, US4 sc1 | new |
| R12 | `docker_too_old`, when zekno did not know the server's Docker before signing | `The server's Docker is older than 29.5, too old to build. Nothing of this deploy ran. Update Docker on that server; zekno doctor shows its version.` | FR-034a, US9 sc3 | new |
| R13 | `no_build_plugin` | `The server's Docker has no build plugin, so it cannot build. Nothing of this deploy ran. Run zekno doctor to see what to install.` | FR-078, Edge cases | new |
| R14 | `low_disk`, with the free space the runner reports | `prod-1 has 1.4 GB of free disk, below the 2 GB a build needs. Nothing of this deploy ran. Free some space on prod-1, then run zekno deploy again.` | FR-040, US9 sc2 | new |
| R15 | (step 1b) `credential_secret`: a signed build names a secret of FR-037b | `This deploy gives a build a secret under a name the builder sends to other hosts. Nothing of it ran. Rename that secret.` | FR-037b | new |

## D. The deploy while it runs

| # | When | Line | Asks | State |
|---|---|---|---|---|
| D1 | The stage row of a deploy that builds: a stage between Sent and Starting (choice D-a) | `✔ Checked  ✔ Signed  ✔ Sent  ✔ Built  ✔ Started`; while it builds `⠹ Building`; not reached `○ Building`; failed `✖ Building`. With a health check, six stages: `… ✔ Built  ✔ Started  ✔ Healthy` | FR-070, US3 sc1 | changed; today `✔ Checked  ✔ Signed  ✔ Sent  ✔ Started` (`ui/parts/deploy-summary.tsx:16`) |
| D2 | While the code is sent: under the stage row, in the live line's place, dim | `sending the code  6 of 18 MB` | FR-070, point 8 | new |
| D3 | Pieces the server lacks, sent again in the same run | `sending what prod-1 lacks  6 of 12 MB` | FR-029a | new |
| D4 | While it builds: the builder's latest line, dim and set in by two, as Docker's line is today | `#9 [build 4/7] RUN npm ci` | FR-070, US3 sc1 | new (today's live line holds Docker's latest line, `ui/ink/deploy-view.tsx:208`) |
| D5 | The same, when the deploy has more than one build: the service first, as `zekno logs` sets its service column | `web  #9 [build 4/7] RUN npm ci` | FR-070 | new |
| D6 | Nothing changed: the server kept the image, so no code was sent and nothing was built. The live line while it lasts; with choice D-b (a), it stays dim under the stage row once the deploy ended, so "nothing sent" is still said (choice D-e for the word) | Option A: `web  kept from deploy 6, nothing sent` · Option B (recommended): `web  reused the build of deploy 6, nothing sent` | FR-070, US5 sc1 | new |
| D7 | The same, in the stage row, when every build of the deploy was reused (choices D-b, D-e) | Option A: `✔ Kept` in place of `✔ Built` · Option B (recommended): `✔ Reused` in place of `✔ Built` | FR-070, US5 sc1 | new |
| D8 | The result (today's) | `✔ shop is live on prod-1 in 72.4s` and dim `zekno logs to watch it, zekno rollback to undo` | US1 sc4 | kept (`ui/ink/deploy-view.tsx:218`, `shared/deploy.ts:330`); its time is choice D-d |
| D9 | After the first deploy of a settings file zekno wrote, for each built service with a port and no domain, under the result | ``web listens on port 3000, but nothing outside prod-1 can reach it yet. Give it a domain with `zekno domain add <domain>`, then run `zekno deploy` again.`` | FR-002c, US1 sc9 | new |
| D10 | Plain output of D9: on standard error; standard output keeps the result line | the same sentence | FR-017 | new |
| D11 | The domain given, deployed again with no change: D6 and D7, then today's lines of 015 | `✔ https://shop.example.com is live  certificate until 17 Feb 2027` | US1 sc10 | kept (015, B5) |
| D12 | A fresh build asked for (choice D-c): the panel's `builds` row, in B28's form (choice B-c) | Option A (recommended): `builds    web and worker, one fresh build with Dockerfile` · Option B: `builds    web, worker  one fresh build with Dockerfile` | FR-021a, point 11 | new |
| D13 | The same, a note in the summary | `The build of web is fresh: every base image is fetched again, and no cached step is used.` | FR-021a | new |
| D14 | Ctrl-C while the code is sent. The next number is the runner's, so it is not named (014's research R19 and 014's C8; `ui/parts/deploy-summary.tsx`, `numberUsed`) | ``Nothing of this deploy ran, and it used no deploy number. Run `zekno deploy` again: it sends only what prod-1 lacks.`` | Edge cases, point 8 | new |
| D15 | Ctrl-C at a terminal while it builds (step 1: no stop, point 24 (b)) | ``! Ctrl-C does not stop this deploy: prod-1 goes on building web, and starts deploy 7 if the build succeeds. Run `zekno status` to see how it ends.`` | FR-045, Edge cases | new |
| D16 | The connection drops while it builds | ``The connection to prod-1 dropped during the build of web. prod-1 goes on with deploy 7, and starts it if the build succeeds. Run `zekno status` to see how it ends.`` | FR-045, US3 sc7 | new |
| D17 | No terminal: the builder's lines on standard error as they come, after today's mark | `remote: #9 [build 4/7] RUN npm ci` | FR-071a | changed; today Docker's lines are written only when the app did not start (`shared/deploy.ts:389-398`) |
| D18 | `zekno rollback` to a deploy whose build is kept: today's line, then D6 and D7 | `Rolling back shop to what deploy 4 ran.` | FR-063, US8 sc1 | kept (`commands/deploy.ts:145`) |

## E. A failed build

The runner did not touch the app that was running. In the order today's failed start draws it (`ui/ink/deploy-view.tsx:233-270`): the lead after `✖`, whose first sentence alone is bold and fits 100 columns with its mark, and whose sentence on which deploy runs follows it on the same line in the text colour; the whole lead fits 100 columns too. Then today's "Number is used" line, dim (E5); then the "Docker said" panel (E3, E4); then a dim line of what to do: E6, or the row's own lines for E7 to E14.

| # | When | Line | Asks | State |
|---|---|---|---|---|
| E1 | A step failed, and a deploy runs | `✖ The build of web failed on prod-1. shop still runs deploy 6.` | FR-071, US3 sc2 | new (spec's draft); for a start that failed today: `prod-1 accepted deploy 7, but the app did not start.` (`ui/ink/deploy-view.tsx:239`) |
| E2 | A step failed, and nothing runs yet | `✖ The build of web failed on prod-1. shop has no deploy running yet.` | FR-071, US3 sc3 | new (spec's draft) |
| E3 | The panel: its title (today's), then the failing step and its error on two labelled rows (choice E-a), then the builder's last 40 lines | `Docker said` · `step   RUN npm ci  (Dockerfile, line 9)` · `error  process "/bin/sh -c npm ci" did not complete successfully: exit code: 1` | FR-071, point 10 | title kept (`ui/ink/deploy-view.tsx:261`); rows new |
| E4 | Inside the panel, first and dim, when the builder wrote more than the last 40 lines | `Showing the last 40 of the builder's 1,252 lines.` | FR-071, FR-071a | new, for a build; a start that failed keeps today's ``Left out Docker's first 12 lines. The last 500 are kept.`` (`shared/deploy.ts:292`) |
| E5 | The number, under the lead (today's) | `Number 7 is used, so the next deploy will be 8.` | FR-043 | kept (`ui/ink/deploy-view.tsx:254`) |
| E6 | Last, dim: what to do, and where the whole output is (choice E-b). The one line that names `zekno logs --build` | ``Read the whole output with `zekno logs --build`. Fix the build, then run `zekno deploy` again.`` | FR-071a, point 23 | new; for a start that failed, today's `Fix zekno.app.json and run zekno deploy again, or go back with zekno rollback.` stays (`shared/deploy.ts:341`) |
| E7 | The Dockerfile copies a file zekno left out | `✖ The build of web failed on prod-1. shop still runs deploy 6.` then ``Its Dockerfile copies .env, which zekno left out: it looks like it holds secrets. Remove that COPY line, and run `zekno secret import .env` to give its values to the running app.`` | Edge cases | new |
| E8 | Out of memory | `✖ The build of web ran out of memory on prod-1 and was stopped.` then ``A build shares prod-1's memory, processor and disk with the apps running there, and one that runs out of memory can make prod-1 stop other programs, shop among them. `zekno status` shows whether shop still runs deploy 6. Give prod-1 more memory or swap space, then run `zekno deploy` again.`` | FR-043a, US3 sc6 | new; the lead does not say which deploy runs, since the server may have stopped it |
| E9 | The time limit | `✖ The build of web was stopped on prod-1 at its time limit of 30 minutes. shop still runs deploy 6.` then ``Raise the limit with `zekno settings set web.build-timeout <seconds>`, up to 7200, or make the build faster.`` | FR-039, US3 sc4 | new; the limit worded as B20 of 015 words it (`shared/start-limit.ts`, `limitWords`) |
| E10 | Free disk fell below the floor during the build | `✖ The build of web was stopped on prod-1: free disk fell below 2 GB. shop still runs deploy 6.` then ``Free some space on prod-1, then run `zekno deploy` again.`` | FR-040, US3 sc5 | new |
| E11 | The image is for another processor | `✖ The image built for web is for ARM64, and prod-1 is x86-64. shop still runs deploy 6.` then ``Remove --platform from the FROM lines of the Dockerfile, then run `zekno deploy` again.`` | FR-041 | new |
| E12 | A fresh build whose record shows a cached step | `✖ The fresh build of web used a cached step, so it counts as failed. shop still runs deploy 6.` then ``Run `zekno deploy --fresh` again. If it says so again, run `zekno doctor`.`` | FR-021a | new |
| E13 | A team list taken during the build no longer lets the signer deploy there | `✖ prod-1 built web, but team list v3 no longer lets Ada deploy there. shop still runs deploy 6.` then ``Deploy 7 was not started. A member whom team list v3 lets deploy to prod-1 can run `zekno deploy` again.`` | FR-044, FR-073, point 7 | new |
| E14 | The runner restarted during the build | `✖ The runner on prod-1 restarted during the build of web. shop still runs deploy 6.` then ``Deploy 7 did not start. Run `zekno deploy` again.`` | Edge cases | new |
| E15 | Another deploy to the same server while one builds: the server is busy | `prod-1 is busy building blog, which started 4 minutes ago and may run up to 30 minutes.` then ``Nothing of this deploy ran. Run `zekno deploy` again once that build ends.`` | FR-044, point 24 | changed; today ``The runner is in the middle of another deploy. Try again in a moment.`` (`cli/errors.ts`, `busy`) stays when the deploy under way does not build |
| E16 | `zekno logs --build` prints the saved output of the app's last build, as plain lines | the builder's lines, as written | FR-071a | new |
| E17 | `zekno logs --build` when nothing is saved | ``This machine has no build output for shop. zekno saves the output of an app's last build when you deploy it at a terminal.`` | FR-071a | new |
| E18 | No terminal: the lead sentence on standard error; the step, the error and the lines as `remote:` lines; exit status 1 | the same sentences as E1 to E14 | FR-071b, US3 sc8 | new |
| E19 | `--json`: the outcome and its reason | `"outcome": "build_failed", "reason": "step_failed"`; reasons `step_failed`, `out_of_memory`, `out_of_disk`, `time_limit`, `wrong_processor`, `cache_used`, `team_changed`, `runner_restarted` | FR-071b, FR-031a | new (spec's draft name) |

## F. What old and new programs say

| # | When | First sentence | Then | Asks | State |
|---|---|---|---|---|---|
| F1 | A deploy that builds, to runner 0.1.1 (or 0.1.0) | `The runner on prod-1 is version 0.1.1, too old to build from source.` | ``Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed.`` | FR-082, US10 sc1 | new (spec's draft), in 015's B10 pattern (`domains/words.ts:236`) |
| F2 | (step 2) A Railpack build, to a runner of step 1 | `The runner on prod-1 is version 0.1.2-dev.1, too old to build with Railpack.` | ``Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed.`` | FR-082, US10 sc4 | new, in F1's pattern |
| F3 | (step 1b) A build that names a build secret, to a runner that builds but does not carry them out; shown only if step 1b ships after step 1 | `The runner on prod-1 is version 0.1.2-dev.1, too old to give a build its secrets.` | ``Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed.`` | FR-082, US10 sc8 | new, in F1's pattern |
| F4 | The server's Docker is older than 29.5, and zekno knows it before signing | `prod-1 runs Docker 28.5, and building needs Docker 29.5 or newer.` | ``Update Docker on prod-1, then run `zekno deploy` again. Nothing was signed.`` | FR-034a, US9 sc3 | new (spec's draft) |
| F5 | A settings file names the Railpack builder, read by a zekno of step 1 (so it ships in step 1) | `zekno.app.json builds web with Railpack, which this version of zekno does not know.` | `Update zekno to use it.` | FR-008, US7 sc3 | new, in SL0's pattern (`settings/words.ts:304`) |

Today's lines, said in new situations. They cannot change: they are in releases already out, or they stay as they are.

| # | When | Line | Asks | State |
|---|---|---|---|---|
| F6 | A deploy that does not build, to runner 0.1.1 | as in feature 015 | US10 sc2 | kept |
| F7 | zekno 0.1.1 deploys any app to the new runner | ``The runner on prod-1 is version 0.1.2-dev.1, newer than this zekno's 0.1.1, and speaks a newer protocol. Update zekno to deploy to prod-1. Nothing was signed.`` | FR-084, US10 sc3 | kept (014's C7, `shared/deploy-words.ts:84`) |
| F8 | zekno 0.1.1 reads a settings file that builds (its first key it does not know, here the `build` section) | `zekno.app.json could not be read as settings. web: a setting this zekno does not know (line 6).` | US7 sc4, point 18 | kept (SV6, `settings/words.ts:101`) |
| F9 | zekno 0.1.1 reads one whose `source` holds `root` first | `zekno.app.json could not be read as settings. web, source: a setting this zekno does not know (line 5).` | US7 sc4 | kept (SV6) |
| F10 | zekno 0.1.1, `zekno settings set web.builder dockerfile` | `There is no such setting. The settings are image, start, restart, memory, cpus, health, health-timeout, port, publish, domains, secrets, plain.<NAME> and volumes.<name>.` | US7 sc8 | kept (CS5, `settings/words.ts:366`) |
| F11 | An older runner handed a build anyway (0.1.1, or a runner of step 1 handed a Railpack build) | `The runner on that server does not carry out everything this deploy asks for. Nothing of it ran. Run zekno status to compare its version with this zekno's.` | FR-083, US10 sc5, sc7 | kept (R7, `cli/errors.ts`) |
| F12 | An older runner put back by hand after the new one wrote its state | `The runner's stored state is damaged or incomplete, so it refuses to act.` | FR-085, US10 sc6 | kept (`invalid_state`, `cli/errors.ts`); the docs say the way back (K14) |
| F13 | `zekno status` and `zekno server add` meet runner 0.1.1 | ``The runner on prod-1 is version 0.1.1, older than this zekno's 0.1.2-dev.1. Deploys still work. Some of what this zekno does needs the newer runner: run `zekno server update prod-1`. This zekno carries a development release.`` (the last sentence while zekno carries a development release) | US10 | kept (014's W3 and D2, `ops/server.ts:175`, `:185`) |
| F14 | `zekno doctor`, the Runner line, for runner 0.1.1 | `0.1.1, older than this zekno's 0.1.2-dev.1`, next `Run zekno server update prod-1` | US10 | kept (`ops/doctor.ts:209-211`) |

## G. Settings, status, doctor and rollback

The names of the build settings are choice G-a. This part uses option (a).

**The settings and their words** (`zekno settings set <service>.<name>`; the file's place; the row's label; the change line's label; the question on the settings screen):

| # | Setting | Set name | File | Row | Change label | Question | Not set (dim) | Asks |
|---|---|---|---|---|---|---|---|---|
| G1 | The folder to send, under Source | `root` | `source.root` | `root` | `root directory` | `Root directory` | `. (the folder of zekno.app.json)` | FR-007, FR-009, point 5 |
| G2 | The builder | `builder` | `build.builder` | `builder` | `builder` | `Builder` | none: a built service has one | FR-007, FR-008 |
| G3 | The Dockerfile's path | `dockerfile` | `build.dockerfile` | `dockerfile` | `Dockerfile path` | `Dockerfile path` | none: set when written | FR-007 |
| G4 | The Dockerfile's stage | `stage` | `build.stage` | `stage` | `Dockerfile stage` | `Dockerfile stage` | `the last stage` | FR-007, point 18 |
| G5 | The time limit | `build-timeout` | `build.timeout` | `time limit` | `build time limit` | `Build time limit (seconds)` | `30 minutes` | FR-007, FR-010 |
| G6 | The network | `build-network` | `build.network` | `network` | `build network` | `Build network` | `internet` | FR-007, FR-038 |
| G7 | The build secrets (step 1b) | `build-secrets` | `build.secrets` | `secrets` | `build secrets` | `Build secrets` | `none` | FR-007, FR-037a |
| G8 | Secret-looking files to send (choice G-b) | `include` | `source.include` | `include` | `files sent although they look like secrets` | `Files to send although they look like secrets` | `none` | FR-015, FR-015a |

**Lines**:

| # | When | Line | Asks | State |
|---|---|---|---|---|
| G9 | `zekno settings` at a terminal, a built service: the new section between Source and Deploy | `Source        root        .` · `Build         builder     Dockerfile` · `dockerfile  Dockerfile` · `stage       runner` · `time limit  60 minutes` · (step 1b) `secrets     NPM_TOKEN` (only the settings that are set, as today) | FR-011, US7 sc1 | changed; today the sections are Source, Deploy, Networking, Variables, Volumes (`settings/types.ts:113`) |
| G10 | Values as rows read them | builder `Dockerfile`, or (step 2) `Railpack`; network `internet` or `none`; time limit in minutes when whole, as 015's B20 (`30 minutes`), else seconds (`90 seconds`) | FR-011 | new |
| G11 | Piped, one line a setting | `web<TAB>source.root<TAB>.` · `web<TAB>build.builder<TAB>dockerfile` · `web<TAB>build.dockerfile<TAB>Dockerfile` · `web<TAB>build.timeout<TAB>3600` · (step 1b) `web<TAB>build.secrets<TAB>NPM_TOKEN` (secrets joined with `,`, as `variables.secrets`) | FR-011 | new |
| G12 | `zekno settings set web.builder dockerfile` on a service that runs an image: one change line | `web · source  ghcr.io/example/shop-web:1.4.2 → built with Dockerfile` | FR-011, US7 sc6 | new |
| G13 | `zekno settings set web.image ghcr.io/example/shop-web:1.4.2` on a built service | `web · source  built with Dockerfile → ghcr.io/example/shop-web:1.4.2` | FR-011, US7 sc6 | new |
| G14 | Other changes, in today's form | `web · Dockerfile path  Dockerfile → docker/web.Dockerfile` · `web · build time limit  30 minutes → 60 minutes` · `web · build network  internet → none` | FR-011 | new, in today's form (`ui/ink/settings-report.tsx:169-198`, `ui/plain/plain.ts:132-135`) |
| G15 | The question and the result (today's) | `? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)` · `✔ Written  Run zekno deploy to use it.` | FR-011 | kept (CS9, CS11) |
| G16 | `unset web.image` on a service with no build | ``A service needs an image or a build, so source.image cannot be unset. To build it instead, run `zekno settings set web.builder dockerfile`.`` | FR-006 | changed; today `A service needs an image, so source.image cannot be unset.` (CS15, `settings/words.ts:395`). Also said to apps that do not build, with no terminal too: an exception to FR-074 for the maintainer to approve (open point 14) |
| G17 | `unset web.builder` | ``A service needs an image or a build, so build.builder cannot be unset. To run an image instead, run `zekno settings set web.image <image>`.`` | FR-006 | new |
| G18 | A setting not known | Step 1: `There is no such setting. The settings are image, root, builder, dockerfile, stage, build-timeout, build-network, include, start, restart, memory, cpus, health, health-timeout, port, publish, domains, secrets, plain.<NAME> and volumes.<name>.` · (step 1b) the same with `build-secrets` after `build-network` | FR-011 | changed (CS5, `settings/words.ts:366`). Also said to apps that do not build, with no terminal too: an exception to FR-074 for the maintainer to approve (open point 14) |
| G19 | `set web.build …` (today a later setting) | the G18 sentence | FR-006 | changed; today `Building from source is not in this version of zekno yet.` (CS6) |
| G20 | A value not allowed (exit status 2): `That is not …` then the rule | Step 1: `That is not a builder.` `Use dockerfile.` · `railpack` to a zekno of step 1: `This version of zekno does not know the builder railpack.` `Update zekno to use it.` (FR-008, in F5's words) · (step 2) `That is not a builder.` `Use dockerfile or railpack.` · `That is not a Dockerfile path.` `Use a path inside the folder sent, such as Dockerfile or docker/web.Dockerfile.` · `That is not a stage name.` `Use the name after AS in a FROM line of the Dockerfile.` · `That is not a time limit.` `Use a number of seconds from 1 to 7200.` · `That is not a build network.` `Use internet or none.` · `That is not a root directory.` `Use a folder inside this git repository, such as . or apps/web.` | FR-011, FR-071b | new, in CS7's form |
| G21 | (step 2) `set web.build-network none` on a Railpack build (exit status 2) | `That change cannot be written. web, build.network: a Railpack build downloads its tools, so it needs the internet.` | point 18, Edge cases | new, in CS17's form |
| G22 | `zekno settings compose`, a built service: its image line and the lines that come with it | `image: zekno.invalid/shop:3f9a1c2b7d4e…`, `pull_policy: never`, and under `environment` `PORT: "3000"` | FR-011, FR-072a | new |
| G23 | (step 2) `zekno settings plan` (choice I-a): the whole plan, as `settings compose` prints the Compose text | Railpack's plan, as JSON | FR-059, point 13 | new |
| G24 | (step 2) `zekno settings plan` for a service built with a Dockerfile | `web is built from a Dockerfile, so it has no Railpack plan.` | FR-059 | new |
| G25 | `zekno settings init` in a folder with a Dockerfile: A7 to A11 with `This writes zekno.app.json.`, then today's `? Service name › web` and IN3 | `✔ Written zekno.app.json  Run zekno deploy to use it.` | FR-011, US7 sc5 | IN3 kept (`settings/words.ts:408`) |
| G26 | The help gains its lines (a line of the help is never edited; a feature adds its own, `cli/help.ts`) | Step 1: `zekno deploy --fresh` · `zekno logs --build [--app <app>]` · `zekno doctor --builds` · (step 2) adds `zekno settings plan` | FR-021a, FR-059, FR-071a, FR-078 | new |

**`zekno status`** (the server's word, never signed: FR-066, FR-080). After the app's line, as 015 put the domain's line there (015's E2):

| # | When | Line | Asks | State |
|---|---|---|---|---|
| G27 | The app's line (today's) | `shop  deploy 7  ● running` | FR-080 | kept |
| G28 | A built service, under it, set in by two | `  web  built today 10:28 with Dockerfile` | FR-080 | new |
| G29 | Under G28, dim: the record, as the server's word | `  prod-1 says: image 3f9a1c2b7d4e, Docker 29.8.2 with BuildKit 0.31.1, cache used, base node:22-slim@sha256:4c2e…9a1f` | FR-066, FR-080 | new |
| G30 | The app's latest build failed, or its connection dropped: how it ended | `  deploy 8  ✖ build failed: out of memory` | FR-045, US3 sc7 | new |
| G31 | (step 2) A Railpack build | `  web  built today 10:28 with Railpack 0.43.1` and `prod-1 says: … built by Railpack's image sha256:1f0b…` | FR-066 | new |
| G32 | No terminal: one line a build, tab-separated, as 015's `domain` lines, with the same field in each column: the app, the service, the deploy, the outcome, then the details | `build<TAB>shop<TAB>web<TAB>7<TAB>built<TAB>dockerfile<TAB>2026-11-26T10:28:00Z<TAB>3f9a1c2b7d4e<TAB>29.8.2<TAB>cached` · a failed one: `build<TAB>shop<TAB>web<TAB>8<TAB>failed<TAB>out_of_memory` | FR-080 | new |

**`zekno doctor`**, for each server that holds a built app, and for every server with `--builds` (FR-078). Labels as today, padded to the detail's column.

| # | When | Line | Next step | Asks | State |
|---|---|---|---|---|---|
| G33 | It can build | `✔ Builds         Docker 29.8.2 with its build plugin, x86-64` | | FR-078 | new |
| G34 | Docker is too old | `✖ Builds         Docker 28.5, older than the 29.5 building needs` | `Update Docker on prod-1` | FR-078, US9 sc3 | new |
| G35 | No build plugin | `✖ Builds         Docker has no build plugin` | `Install Docker's build plugin (docker-buildx-plugin) on prod-1` | FR-078, US9 sc4 | new |
| G36 | A runner that does not build | `✖ Builds         runner 0.1.1 does not build` | `Run zekno server update prod-1` | FR-078 | new |
| G37 | What Zekno's builds take | `✔ Build disk     6 GB in built images and build cache` | | FR-079, US9 sc5 | new |
| G38 | Free disk below the floor | `! Disk           1 GB free, below the 2 GB a build needs` | `Free some space on prod-1 before the next build` | FR-040, FR-078 | changed; today `Free some space on prod-1 before the next deploy` below 1 GiB (`ops/doctor.ts:237`) |
| G39 | Memory (choice G-c) | `✔ Memory         4 GB`. Below 2 GB, option A: `! Memory         1 GB; a build may run out of memory below 2 GB`, next step `Give prod-1 more memory or swap space`. Option B (recommended): `! Memory         1 GB, less than 2 GB`, next step `Give prod-1 more memory or swap space before it builds` | | FR-078, FR-089b, US9 sc5, point 22 | new |
| G40 | (step 2) This machine, once it fetched Railpack, or with `--builds` | `✔ Railpack       0.43.1, checksum verified` · changed on disk: `! Railpack       0.43.1 changed since it was fetched`, next step `zekno fetches it again at the next deploy that needs it` · with `--builds` before any fetch, dim in the form of a row not checked: `– Railpack       not fetched on this machine`, next step `zekno fetches it at the first deploy that needs it` | | FR-079 | new |
| G41 | A server with no built app, no `--builds` | as today | | US9 sc6 | kept |
| G42 | Plain output, as today's rows | `prod-1<TAB>builds<TAB>good<TAB>Docker 29.8.2 with its build plugin, x86-64` | | FR-078 | new |

**`zekno rollback`**:

| # | When | First sentence | Then | Asks | State |
|---|---|---|---|---|---|
| G43 | The server no longer keeps the build of that deploy | `prod-1 no longer keeps the build of deploy 1.` | `Nothing of this rollback ran. To go back to it, deploy that code again from a checkout.` | FR-064, US8 sc2 | new (spec's draft) |
| G44 | The kept image's name now leads to another image | `The image prod-1 kept for deploy 4 has changed since it was built, so prod-1 will not run it.` | `Nothing of this rollback ran. To go back to it, deploy that code again from a checkout.` | FR-062, US8 sc3 | new |
| G45 | (step 1b) Its build read a secret set again since | `NPM_TOKEN was set again after deploy 4 of shop was built, so prod-1 cannot reuse that build.` | `To go back to it, deploy that code again from a checkout. Nothing was signed.` | FR-064a, US8 sc6 | new; the spec's draft (`… with an earlier NPM_TOKEN, set again since, …`) is 106 columns, so it is shortened |
| G46 | (step 1b) Its build read a secret removed since | `NPM_TOKEN was removed after deploy 4 of shop was built, so prod-1 cannot reuse that build.` | `To go back to it, deploy that code again from a checkout. Nothing was signed.` | FR-064a, US8 sc7 | new, worded as G45 |

## H. Step 1b, build secrets

| # | When | Line | Asks | State |
|---|---|---|---|---|
| H1 | `zekno settings set web.build-secrets NPM_TOKEN`: the change line, then G15 | `web · build secrets  none → NPM_TOKEN` | FR-037a, US12 | new |
| H2 | The summary's `reads` row (B10) | `reads     API_URL (a plain variable)` · `NPM_TOKEN (a build secret)` | FR-072b, US12 sc1 | new |
| H3 | Every deploy whose build reads a named secret: B14 in this form, for each base image named without a digest | `! The Dockerfile of web starts from node:22-slim by tag: whoever controls that tag can read NPM_TOKEN during the build.` then B14's dim line | FR-042a, FR-037f | new |
| H4 | The question, once per secret, service, app and server. Its block names each base image of the build named without a digest (H4a) | `? Give NPM_TOKEN to the build of web? A build that reads a secret and reaches the internet can send it anywhere, and no signature prevents it. (y/N)` | FR-037f, US12 sc1 | new (the spec's draft, its question put first, as every yes-or-no question of zekno is) |
| H4a | In H4's block, between H4 and H5, one line for each base image named without a digest | `It starts from node:22-slim by tag: whoever controls that tag can read NPM_TOKEN during the build.` | FR-037f, FR-042a | new |
| H5 | Under H4, dim | `zekno asks once on this machine for each secret, service, app and server.` | FR-037f | new |
| H6 | No to H4, Esc or Ctrl-C | B25's two forms: `✖ Nothing was done.`, or `✖ Nothing more was done. …` once this run made something | FR-037f | kept (`cli/errors.ts:34`; `NOTHING_MORE`, `asking/first-deploy.ts:101`) |
| H7 | It builds again because a build secret was set again | `NPM_TOKEN was set again, and the build of web reads it, so web is sent and built again.` | FR-072c, US12 sc4 | new, in B23's pattern |
| H8 | A secret named in `build.secrets` that the app does not read when it runs | nothing more: B20 lists only what reaches the running app | FR-037a | none |

| # | When | First sentence | Then | Asks | State |
|---|---|---|---|---|---|
| H9 | No terminal, and no earlier yes on this machine | `The build of web reads NPM_TOKEN, and no one said yes to that on this machine.` | ``Run `zekno deploy` once at a terminal to answer. Nothing was signed.`` | FR-037f, US12 sc2 | new |
| H10 | A credential name, at deploy (exit status 1) | `GIT_AUTH_TOKEN cannot be given to a build: the builder would send it to the hosts it fetches from.` | `Set it under another name. Nothing was signed.` | FR-037b, US12 sc5 | new (spec's draft) |
| H11 | The same, at `zekno settings set` (exit status 2) | `GIT_AUTH_TOKEN cannot be given to a build: the builder would send it to the hosts it fetches from.` | `Set it under another name.` | FR-037a, FR-037b | new |
| H12 | Not a secret of the app | `The build of web reads NPM_TOKEN, and shop has no secret of that name on prod-1.` | ``Set it with `zekno secret set NPM_TOKEN`, or take it off web's build secrets. Nothing was signed.`` | FR-037a, US12 sc7 | new |
| H13 | Removed with `zekno secret rm` | `The build of web reads NPM_TOKEN, which was removed from shop.` | ``Set it again with `zekno secret set NPM_TOKEN`, or take it off web's build secrets. Nothing was signed.`` | FR-037a, US12 sc7 | new |
| H14 | More than 32 for one build, at `zekno settings set` (exit status 2) | `That change cannot be written. web, build.secrets: at most 32 names.` | | FR-037a | new, in CS17's form |
| H15 | (step 2) A Railpack build that names a build secret | `web is built with Railpack, and this version of zekno cannot give a Railpack build a secret yet.` | `Take NPM_TOKEN off web's build secrets, or build web with a Dockerfile. Nothing was signed.` | FR-037h, US12 sc8 | new (spec's draft) |
| H16 | (step 2) The same, at `zekno settings set` (exit status 2) | `That change cannot be written. web, build.secrets: a Railpack build cannot read a secret in this version of zekno.` | | FR-037a, FR-037h | new |
| H17 | A secret the Dockerfile declares with `ARG` | B18, B19 | | FR-036e | new |
| H18 | A rollback after the secret was set again, or removed | G45, G46 | | FR-064a | new |
| H19 | A runner that builds without secrets | F3 | | FR-082 | new |

`zekno secret set NPM_TOKEN` and `zekno secret rm NPM_TOKEN` keep their lines (`commands/secret.ts:35`, `:46`): `Set NPM_TOKEN (version 3) for shop on prod-1. It takes effect on the next deploy.` A place that may want a line, not proposed: `zekno secret rm` of a secret a build names, which makes the next deploy stop with H13.

## I. Step 2, Railpack

| # | When | Line | Asks | State |
|---|---|---|---|---|
| I1 | A folder with no Dockerfile, no settings file and no Compose file, at a terminal: the first question, before anything is fetched or run | `? Fetch Railpack (24 MB) to find out how to build this folder? There is no Dockerfile here. (y/N)` | FR-060b, US6 sc1, point 17 | new (the spec's draft, its question put first) |
| I2 | The same, with Railpack already on this machine | `? Run Railpack to find out how to build this folder? There is no Dockerfile here. (y/N)` | point 17 | new |
| I3 | Under I1 and I2, dim | `Railpack is a program made by Railway. zekno runs it on this machine, on the files it would send, and Railpack looks up language versions online.` | FR-055, point 17 | new |
| I4 | No to I1 or I2, Esc or Ctrl-C: nothing fetched or run | A13, in the form choice A-c picks | FR-060b | kept |
| I5 | While it fetches (the step's spinner, as `Connecting prod-1`) | `Fetching Railpack 0.43.1` | point 12 | new |
| I6 | The fetch line | `✔ Railpack 0.43.1 fetched  24 MB from Railpack's release on GitHub, checksum verified` | FR-055, US6 sc2, point 12 | new, in the pattern of `✔ Runner installed  110 MB, checksum verified` (`asking/first-deploy.ts:490`) |
| I7 | What Railpack found | `✔ Railpack found a Node app  Node 22.23.5, npm` | US6 sc4, point 17 | new |
| I8 | The second question: A2 to A12 with Railpack's words. A3's Build rows read `builder  Railpack`; the port is a default (choice I-b) | `? Build this folder on your server with Railpack? This writes zekno.app.json and .dockerignore.` and the first answer `Build, port 3000` with its detail. Option A: `a default: the app must listen on PORT`. Option B (recommended): `a default: zekno sets PORT to it` | FR-002, FR-002a, FR-072a, US6 sc5 | new |
| I9 | The short form of the plan, in the summary (B) | `Railpack's plan for web` then `language  Node 22.23.5, with npm` · `install   npm ci` · `build     npm run build` · `start     npm run start` · `images    railpack-builder and railpack-runtime, pinned by this zekno` | FR-059, point 13 | new |
| I10 | The whole plan | ``Run `zekno settings plan` to read the whole plan.`` (dim, under I9) | FR-059 | new |
| I11 | The settings' start command wins over the plan's | `web starts with bun run start from zekno.app.json, not with npm run start from the plan.` | Edge cases | new |
| I12 | The plan changed since the app's last deploy, and why | `Railpack now picks Node 22.23.6 (was 22.23.5), so web is sent and built again.` | FR-059, US6 sc6, point 25 | new (spec's draft) |
| I13 | The plan changed, the reason not known | ``Railpack's plan for web changed since deploy 6, so web is sent and built again. Run `zekno settings plan` to read it.`` | FR-059 | new |
| I14 | A warning: no lockfile (for npm; each language names its own tool and file) | ``! This folder has no lockfile, so prod-1 may install package versions you have not tested. Run `npm install` and commit package-lock.json.`` | FR-060a, point 16 | new |
| I15 | What the signature does not cover, for Railpack | `This signature does not cover what the build downloads while it runs, such as packages and language tools.` | FR-072, US4 sc4 | new |
| I16 | A plain variable a Railpack build is not given (a name of FR-037b) | `! The build of web is not given GIT_AUTH_TOKEN: the builder would send it to the hosts it fetches from.` | FR-036b, FR-036d | new |
| I17 | The copy on this machine changed on disk (a warning; then I5 and I6) | `! The copy of Railpack on this machine changed since zekno checked it, so zekno fetches it again.` | FR-053 | new |
| I18 | A deploy whose settings already chose Railpack, on a machine without it: no question, I5 and I6 | | point 12 | new |
| I19 | No terminal: I6 and I7 on standard error | the same sentences | FR-055 | new |
| | I29 to I31 were added after the first reading, so they follow I19 | | | |
| I29 | `zekno settings init` in a folder with no Dockerfile: I1 or I2 and I3, then I5 to I7, then I8's question with `This writes zekno.app.json.` and its last row `Run an image instead` `asks for its name`, then today's `? Service name ›` and IN3. No to I1 or I2 goes on to today's `? Image ›` | the lines named | FR-011 | new; IN3 kept (`settings/words.ts:408`) |
| I30 | A deploy after zekno was updated to a version that uses another Railpack: why it builds again, in the summary | `zekno now uses Railpack 0.44.0 (was 0.43.1), so web is sent and built again.` | FR-059, Edge cases | new, in I12's pattern |
| I31 | No terminal, or `--json`, in a folder with no Dockerfile, no settings file and no Compose file: nothing is fetched or run | A16: today's sentence for a folder with no Compose file, on standard error, exit status 1 | FR-003, FR-060b, US6 sc1 | kept |

| # | When | First sentence | Then | Asks | State |
|---|---|---|---|---|---|
| I20 | The fetched file does not match the checksum zekno carries | `The Railpack 0.43.1 file on Railpack's release does not match the checksum this zekno carries.` | `zekno deleted it and ran nothing. A folder with a Dockerfile still deploys. Nothing was signed.` | FR-053, US6 sc3 | new |
| I21 | The fetch failed | `zekno could not fetch Railpack 0.43.1 from Railpack's release.` | `Check this machine's connection, then deploy again. A folder with a Dockerfile still deploys. Nothing was signed.` | Edge cases | new |
| I22 | Railpack cannot reach the network at a later deploy | `Railpack needs the network to plan the build of web, and it could not reach it.` | `Check this machine's connection, then deploy again. Nothing was signed.` | FR-055, US6 sc7 | new |
| I23 | No Railpack checksum for this system | `This zekno has no Railpack for Linux on ARM64, so it cannot plan a build here.` | `Add a Dockerfile to build this folder. Nothing was signed.` | FR-057, US6 sc10 | new |
| I24 | Railpack cannot make a plan: its own reason, cleaned, after the colon. In a folder with no settings file yet, the second way has no service to set (see the open points) | `Railpack cannot tell how to build this folder: no start command was found.` | ``Add a Dockerfile, or set a start command with `zekno settings set web.start <command>`. Nothing was signed.`` | FR-058, US6 sc8, point 14 | new |
| I25 | The plan names an image zekno holds no digest for | `Railpack's plan for web names ghcr.io/acme/base:1, an image this zekno does not pin.` | `Remove it from railpack.json, or build web with a Dockerfile. Nothing was signed.` | FR-060, point 15 | new |
| I26 | A fresh build with Railpack | `web is built with Railpack, and this version of zekno cannot make a fresh Railpack build yet.` | `Deploy without --fresh, or build web with a Dockerfile. Nothing was signed.` | FR-021a, point 11 | new |
| I27 | More than 32 plain variables a Railpack build would be given: C14's first sentence, as FR-036d asks | `The build of web would read 33 plain variables, over the 32 a build can carry.` | `A Railpack build reads every plain variable of web. Remove some, or build web with a Dockerfile. Nothing was signed.` | FR-036c, FR-036d, US11 sc8 | new |
| I28 | A runner of step 1 | F2 | | US10 sc4 | new |

## J. The full-screen app

Choice J-a decides whether the app asks the first-time questions itself.

| # | Where | Line | Asks | State |
|---|---|---|---|---|
| J1 | Deploy screen: the panel's new rows | B28 | FR-070 | new |
| J2 | Deploy screen: the stage row | D1, D7 | FR-070 | changed |
| J3 | Deploy screen: the live line under the stage row | D2, D3, D4, D5, D6 | FR-070 | new |
| J4 | Deploy screen: above the panel, in B1 of 015's place (`PointedLines`), the summary's block, then its warnings in the warning colour; the size row's facts in the panel | The block and its notes: B1 to B11, B20 to B23, D13, I9 to I13, I30. The warnings: B12 to B19, H3, I14, I16 | FR-017, FR-059, FR-072, FR-072b | new |
| J5 | Deploy screen: `o` shows the builder's lines | `o show Docker's output`, the panel `Docker's output` | point 10 | kept (`app/screens/deploy.tsx:216`, `:251`) |
| J6 | Deploy screen: a failed build, the result line in the error colour | E1 to E14, the whole lead (both sentences, so which deploy runs is said) | FR-071 | new |
| J7 | Deploy screen: then the panel `Docker said` with E3's rows, E5, and E6 dim | E3 to E6 | FR-071, FR-071a | panel kept, rows new |
| J8 | Deploy screen: the header's time | `72.4s`, or with choice D-d `1m 12s` | | kept or changed |
| J9 | Deploy screen, leaving while it builds (today's) | `Leaving this screen does not cancel the deploy. Quitting zekno waits for it to finish.` | FR-045 | kept (`app/screens/deploy.tsx:266`) |
| J10 | `d` in a folder with a Dockerfile and no settings file, with either option of choice J-a | ``This folder has a Dockerfile and no settings file. Run `zekno deploy` here once to set it up.`` · (step 2) in a folder with no Dockerfile: ``This folder has no settings file. Run `zekno deploy` here once to set it up.`` | FR-002, FR-060b | changed; today ``There is no compose.yaml in ~/code/shop, and no zekno.json names another. Run zekno link -f <file> here to name one.`` (`app/effects/deploys.ts:210`) |
| J11 | `d` when the deploy needs a first-time yes: B24, B26 or H4 (choice J-a, option b) | ``This deploy needs your answer to a question zekno asks once on this machine. Run `zekno deploy` here to answer it.`` | FR-015a, FR-015b, FR-037f | new |
| J12 | The same with option (a): the question in the panel of "Remember this folder?" (`app/screens/deploy.tsx:371`), its title the question, its body the summary, and for H4 the lines H4a and H5 | B24, B26, H4 as panel titles | FR-015a, FR-015b, FR-037f | new |
| J13 | App screen, the list of deploys: a deploy whose build failed | `✖ build failed` | FR-071 | new; today `✔ started`, `✖ did not start` (`app/screens/app.tsx:75-79`) |
| J14 | App screen, the selected deploy's `services` row | `services  web, worker (built with Dockerfile)` | FR-080 | changed; today `services  web (ghcr.io/example/shop-web:1.4.2)` |
| J15 | Settings screen, Source: a built service's row | `root       .` | FR-011 | new |
| J16 | Settings screen, the new section after Source, every row drawn, the ones not set dim | `Build` · `builder    Dockerfile` · `dockerfile Dockerfile` · `stage      the last stage` · `time limit 30 minutes` · `network    internet` · (step 1b) `secrets    none` | FR-011 | new |
| J17 | Settings screen, a changed build setting | `! changed, not deployed (was Dockerfile)` | FR-011 | kept (AS3) |
| J18 | Settings screen, changing a row: the panel `Change a setting` with the row's question (G1 to G8) | `Builder`, `Dockerfile path`, … | FR-011 | new questions, kept panel (AS4) |
| J19 | Settings screen, emptying the image of a service with no build | `A service needs an image or a build.` | FR-006 | changed; today `A service needs an image.` (`settings/words.ts:500`) |
| J20 | Home | no change | | kept |

## K. The README and the docs

Each sentence is proposed for the page named. The docs pages are in `apps/web/content/docs/`.

| # | Page, place | Proposed | Asks | State |
|---|---|---|---|---|
| K1 | README, "What works today", a new row | Step 1: `Build an app on your server from a folder of code with its Dockerfile` · `zekno deploy` in that folder · [Building from source](https://www.zekno.dev/docs/building). After step 2, the first cell adds `, or with Railpack` | FR-087, FR-093 | new |
| K2 | README, the line under that table | `Domains and health checks need runner 0.1.1 or later on the server. Building needs runner 0.1.2-dev.1 or later, a development release, and Docker Engine 29.5 or later. Not built yet: teammates, the hosted service. See the roadmap.` (After step 2: `Railpack needs runner 0.1.2-dev.2 or later.`) | FR-087 | changed; today `Domains and health checks need runner 0.1.1 or later on the server. Not built yet: teammates, the hosted service, building from source. See the roadmap.` |
| K3 | README, "What Zekno does not protect against", a new row | `What a build downloads while it runs` · `Base images named by tag, packages and language tools are fetched on the server during the build. No signature covers them.` (Step 1: without `and language tools`, which comes with Railpack after step 2.) | FR-072, FR-087, FR-093 | new |
| K4 | the same, a new row | `A build that runs out of memory` · `A build shares the server's memory, processor and disk with the apps already running there. One that runs out of memory can make the server stop other programs, the running app among them.` | FR-043a, FR-087 | new |
| K5 | (step 1b) the same, a new row | `A secret named for a build` · `It stays on your server, so Zekno cannot read it. But the build's steps run other people's code, and a build that reads a secret and has the network can send it anywhere. No signature prevents it.` | FR-037g, FR-087 | new |
| K6 | (step 2) the same, a new row | `Railpack, which zekno fetches and runs on your machine` · `Railpack, at the version zekno pins, and the image it builds with on the server, are trusted as zekno is. Railpack runs with your rights on the machine that signs, and its plan decides what the server runs. The checksum makes every machine run the copy the maintainer approved. It does not make that copy safe.` | FR-087 | new |
| K7 | the same, the row "One of your servers is compromised" | `Secrets are plaintext in memory where the app runs, and the server holds the TLS keys of its domains and, for an app built there, its code, in Docker's storage and in the image` | FR-087 | changed; today `Secrets are plaintext in memory where the app runs, and the server holds the TLS keys of its domains` |
| K8 | README, the note on what the hosted service will see: the items after "With domains, building from source and health checks, it will also see:" | `Domains` · `For each build: the Dockerfile's path and stage, or Railpack's version and the digests it pins; the plain variables the build reads, with their values; the names of the secrets it reads; its network and time limit; and whether a fresh build was asked for` · `Pre-deploy commands and health-check paths` · `The size, the number of pieces and the fingerprint of each build's code: enough to confirm a guess of the exact code (a public repository at a known commit), not to read it` · and after the list: `The code travels sealed for your server, and what the builder prints travels sealed for the person who deployed, or not at all.` The Railpack clause (`or Railpack's version and the digests it pins`) comes after step 2, and `the names of the secrets it reads` from step 1b | FR-027, FR-087, FR-093 | changed; today `Build recipes and their arguments, pre-deploy commands, health-check paths` and `The size and fingerprint of each source pack: …` (`README.md`, test `apps/cli/test/docs/metadata-note.test.ts`) |
| K9 | README, a new part "Building from source" after "Domains and HTTPS" | `What is built is signed: the code, the recipe (the Dockerfile's path and stage, or Railpack's plan), the builder and its version, the plain variables the build reads and the names of the secrets it may read. The code travels sealed for the server, so no other machine can open it. The server holds the code in plain text, in Docker's storage and in the image. What the builder prints can quote the code; it goes only to the zekno that deployed, and the runner keeps none of it. See [what the signature covers](https://www.zekno.dev/docs/building#what-is-signed).` The clause `or Railpack's plan` comes after step 2, and `the names of the secrets it may read` from step 1b | FR-087, FR-093 | new |
| K10 | README, the roadmap, once step 2 is built | `- [x] Building an app from source on your own server: with its Dockerfile, or with Railpack (CLI and runner)` | FR-087 | changed; today `- [ ] Building an app from source` |
| K11 | Docs, a new page `building.mdx`, "Building from source": its description | `zekno deploy in a folder of code: what is sent, what is signed, how the server builds it, and what the signature covers and does not.` | FR-086 | new |
| K12 | building, "What is signed" | `The signature covers the code, the recipe, the builder and its version, the plain variables the build reads with their values, the names of the secrets it may read, its network and its time limit. It does not cover what the build downloads while it runs: for a Dockerfile, base images named by tag and what its steps fetch; for Railpack, the packages and language tools its steps fetch. Nor does it cover the server's Docker and builder versions, base images already on the server, or steps reused from the server's build cache, which every app on the server shares. Network none applies to the build's own RUN steps only: the builder still fetches base images, and files that ADD names by URL.` The Railpack clause comes after step 2, and `the names of the secrets it may read` from step 1b | FR-038, FR-072, FR-086, FR-093 | new |
| K13 | building, "What is sent" | `zekno sends the folder's files, except those .dockerignore lists, as docker build would. It never sends a link. It leaves out .git unless the settings name it, and every file that looks like it holds secrets unless the settings name it and you agreed to it on this machine. That list holds .env and .env.* in any folder, .npmrc, .netrc, .git-credentials, and files whose name or content marks a private key. It is a convenience, not a guarantee: a secret in a file of another name is sent.` | FR-014, FR-015, FR-015a, FR-086 | new |
| K14 | building, "What the server holds". The second sentence has two forms: until the checks of FR-089 show the runner's removal works, `Docker's builder keeps a record of each build on the server, with its output and its build arguments.`; after them, as written here | `The server holds the code in plain text, in Docker's storage and in the image. Docker's builder keeps a record of each build, with its output and its build arguments, until the runner removes it after the build. What the builder prints can quote the code, and holds anything a step prints. The runner keeps the images of the deploy each app runs and of its two latest other builds, and brings the build cache to 10 GiB after each deploy. That pruning also reaches builds made outside Zekno on the same server. An older runner put back by hand refuses to act; the way back is to update the runner again.` | FR-031b, FR-068, FR-085, FR-086 | new; the first form is the one FR-031b asks for while the removal is not shown |
| K15 | building, "Memory and disk" | `A build shares the server's memory, processor and disk with the apps already running there. A build that runs out of memory can make the server stop other programs, the running app among them. zekno does not limit a build's memory in this version. A build does not start below 2 GB of free disk, and stops if it falls below it. What a server with 1 GB of memory does during such a build has not been measured.` | FR-043a, FR-086, FR-089b | new |
| K16 | building, "Docker on the server" | `Building needs Docker Engine 29.5 or later on the server, with its build plugin. zekno doctor --builds says whether a server can build. A server that cannot build still runs apps from images. A base image in a private registry works when the server's Docker is logged in to it.` | FR-034a, FR-086 | new |
| K17 | building, "Variables in a build" | `A Dockerfile build reads the plain variables of its service that it declares with ARG, and no other. A Railpack build reads every plain variable of its service, at most 32. A plain variable given to a build is signed, readable by whoever relays the deploy, as it is in the settings, and stays readable in the image's history of a Dockerfile build. A secret never reaches a build through ARG.` The Railpack sentence comes after step 2 | FR-036a, FR-036d, FR-086, FR-093 | new |
| K18 | building, "Secrets in a build" (step 1b) | `A build reads a secret only when its settings name it, one by one, and you agreed on this machine. zekno asks once for each secret, service, app and server, and not again when the recipe changes. The secret stays on your server, so Zekno cannot read it. But it travels further on the server than today: it is handed to steps that run other people's code and download from the internet. A build that reads a secret and has the network can send it anywhere, and no signature prevents it. A step that copies it into a file puts it in the image. A step that prints it puts it in the build's output: in Docker's record of the build on the server until the runner removes it, in the output zekno saves on your machine, and with no terminal in whatever log reads standard error. A step that writes it into a cache folder (RUN --mount=type=cache) leaves it there for later builds of the app, even builds that read no secret and reuse no cached step.` Then the example: `RUN --mount=type=secret,id=NPM_TOKEN npm ci` | FR-037g, FR-031b, FR-071a, Edge cases | new |
| K19 | (step 2) building, "Railpack" | `Railpack is a program made by Railway, a third party. zekno fetches the one version it pins from Railpack's own release, checks it against a checksum zekno carries, and runs it on your machine, with your rights, on the files it would send. It reaches the network to find language versions, so each deploy with Railpack needs the network. Its plan decides what the server runs. The checksum makes every machine run the copy the maintainer approved. It does not make that copy safe. The image Railpack builds runs as root inside its container, and starts through a shell.` | FR-055, FR-086, FR-087 | new |
| K20 | building, "What was checked, and where" | `Each finding of the checks on Linux, with where it ran: GitHub's Linux machines, a throwaway Linux container, or the maintainer's own server.` (filled by the plan) | FR-089, FR-089b | new |
| K21 | Docs, `index.mdx`, "Status and limits" | `App settings cover an image that is already built, or one built on your server from a folder of code. This version cannot run a command before a deploy, or run several copies of a service.` | FR-086 | changed; today `App settings cover an image that is already built. This version cannot build an image from source, run a command before a deploy, or run several copies of a service.` |
| K22 | Docs, `settings.mdx` | the Build section and `source.root` (G1 to G8), and `source.build` taken out of "Settings this version does not have" | FR-086 | changed |
| K23 | Docs, `deploying.mdx` | the build stage, a kept image, a failed build, `zekno deploy --fresh`, `zekno logs --build`, a rollback to a built deploy | FR-086 | changed |
| K24 | Docs, `doctor.mdx`, `secrets.mdx`, `output.mdx`, `cli.mdx` | G33 to G42; H; `build_failed` and exit statuses; G26 | FR-086 | changed |
| K25 | Docs, `security.mdx` | K3 to K9, and the callout "Metadata" with K8's words | FR-086 | changed |
| K26 | Docs, `runner.mdx`, "Protocol 3" | `Deploy format 2 also has fields for a command to run before a deploy. The runner does not carry it out, and refuses a deploy that uses it. It builds from source from protocol 6 (with a Dockerfile) and protocol 7 (with Railpack).` Each step raises today's protocol 5 by one (FR-081). Step 1: without `and protocol 7 (with Railpack)` | FR-081, FR-086, FR-093 | changed; today `Deploy format 2 also has fields for builds from source and a command to run before a deploy. The runner carries out neither, and refuses a deploy that uses one.` |
| K27 | Docs, `runner.mdx`, a new section `### Protocol 6`, after "Protocol 5" | `Protocol 6 means the runner also builds an app from source with a Dockerfile: it checks the sealed code against the signature, then builds the image with the server's own Docker (see [Building from source](/docs/building)). A deploy can end with one more outcome, after its number is used: build_failed, with its reason.` (step 1b, when it ships in this protocol) `It also gives a build the secrets its settings name.` The requests and fields are filled by the plan | FR-081, FR-086 | new |
| K28 | (step 2) Docs, `runner.mdx`, a new section `### Protocol 7` | `Protocol 7 means the runner also builds with Railpack, from the plan signed with the deploy, with the Railpack image whose digest is signed.` (step 1b, when it ships in this protocol) `It also gives a Dockerfile build the secrets its settings name.` | FR-081, FR-086 | new |

## Choices for the maintainer

Each choice has two options and a recommendation. Where the habit already decides, no choice is put. Options marked (A) and (B) are the two wordings the two readings of this file pulled apart; the others are the writer's.

- **A-a. How the first-deploy question shows what it writes.** (a) As `zekno add` shows its summary: a title line per thing, and the settings file as the rows `zekno settings` will show for it. (b) Each file's own text in a dim box, as the app's "Remember this folder?" shows zekno.json. **Recommended: (a)**, because the person then meets the same rows again in `zekno settings`.
- **A-b. How the port is asked.** (a) One list question with the port in its answers (A7 to A9). (b) A yes-or-no question, then `? Port ›` with the found port filled in. **Recommended: (a)**: the common case is one key press, which SC-001's "one answer" asks for, and "no port" is an answer, not an empty field.
- **A-c. What `Don't build` says at a terminal** (A13, and I4 for Railpack's first question). (a) Today's `✖ No Compose file at /Users/ada/code/shop/compose.yaml.` then ``Point to one with `-f <file>`.``, as FR-002 says. (b) Today's `✖ Nothing was done.`, as every other question declined says it; FR-002 changes for a terminal, and with no terminal A16 keeps today's sentence (FR-003). **Recommended: (b)**: a person who just chose `Don't build` would read about a Compose file they never named.
- **B-a. Which notes show at every deploy** (B8, B20, B21, I15; FR-072 leaves its lines to the boards). B7, B11 and B22 show at every deploy that has them, since the spec asks for them in the summary (US2 sc3, FR-072a, FR-038). (a) At every deploy that builds. (b) At the first deploy from the folder on this machine, and again when what they say changes; the rows and the warnings show every time. **Recommended: (b)**: a note said at every deploy stops being read. B14, a warning, shows at every deploy that has it, as FR-042a asks.
- **B-b. Where the summary's facts go.** (a) A block above the deploy panel, and two rows in the panel (`builds`, `sends`). (b) Every fact as a row of the panel. **Recommended: (a)**: the panel is redrawn live and the app's screen has few rows; the block stays above as a record, as 015's DNS line does.
- **B-c. The words of the panel's `builds` row** (B28, D12). (A) B9's words: `web and worker, one build with Dockerfile`, so the same fact reads the same way above the panel and in it. (B) The panel's own form, as its `from` row draws its services: `web, worker  with Dockerfile`, the detail dim. **Recommended: (A)**: one fact in one wording, and it keeps "one build", which says the two services share it.
- **D-a. The build stage's name.** (a) `Building` while it runs or when it failed, `Built` once done, as `Starting` becomes `Started`. (b) `Built` in every state, as `Checked`, `Signed` and `Sent`. **Recommended: (a)**: it is the stage next to it that a person reads the same way.
- **D-b. How "nothing built, nothing sent" shows** (D6, D7). (a) The stage reads the word of choice D-e when every build was reused. D6's line shows while it lasts, and stays dim under the stage row once the deploy ended, so "nothing sent" is still said (US5 sc1, FR-070). (b) The stage reads `✔ Built`, and a dim line under the result says it. **Recommended: (a)**: the row says it where the build stage stands.
- **D-c. The option for a fresh build.** (a) `zekno deploy --fresh`. (b) `zekno deploy --no-cache`, the word Docker and Railway's `NO_CACHE` use. **Recommended: (a)**: one word, "fresh", in the option, the summary and the sentences; and it does more than skip the cache, since it fetches every base image again.
- **D-d. The time of a long deploy.** (a) Today's form, `in 312.6s`. (b) Past one minute, `in 5m 12s`, at a terminal and in the app's header. Plain output keeps its result line, which has no time (`shared/deploy.ts`, `startedSentence`; FR-017, US2 sc8). **Recommended: (b)**: builds make deploys last minutes.
- **D-e. The word for a build this deploy did not make again** (D6, D7). (A) `Kept`, `web  kept from deploy 6, nothing sent`: the spec's word (US5 sc1, FR-070), and this file's word for an image the server keeps. (B) `Reused`, `web  reused the build of deploy 6, nothing sent`: what this deploy did, a verb beside `Checked`, `Signed` and `Sent`; the server still "keeps" the image, as G43 and D18 say. **Recommended: (B)**: `✔ Kept` reads oddly in a row of things done, and a newcomer reads "reused" at once.
- **E-a. The failing step in the "Docker said" panel.** (a) Two labelled rows, `step` and `error`, then the builder's last lines. (b) The builder's own two lines first, with no labels. **Recommended: (a)**: the labels say which line is the cause, and the Dockerfile's line number finds the step.
- **E-b. Where the whole output is read.** (a) `zekno logs --build`, as Railway's CLI has `railway logs --build`. (b) The path of the file on this machine. **Recommended: (a)**: one command on every system, and it works with `--app`.
- **G-a. The names of the build settings.** (a) Railway's words: `source.root` ("Root Directory" on Railway and Render), `build.builder`, `build.dockerfile`, `build.stage`, `build.timeout`, `build.network` with `internet` or `none`, `build.secrets`. (b) Docker's words: `source.context`, `build.builder`, `build.dockerfile`, `build.target`, `build.timeout`, `build.network` with `default` or `none`, `build.secrets`. **Recommended: (a)**: a Railway user finds Root Directory and Builder where they look, and Docker's words stay only where Railway has none.
- **G-b. Where the settings name a secret-looking file to send** (the spec says "unless the settings name it", and names no setting). (a) `source.include`, a list of paths. (b) `build.files`. **Recommended: (a)**: it is about what is sent, which the Source section holds.
- **G-c. The doctor's memory warning** (G39). (A) `1 GB; a build may run out of memory below 2 GB`. (B) `1 GB, less than 2 GB`, with the next step `Give prod-1 more memory or swap space before it builds`. **Recommended: (B)**: 2 GB is a warning figure until a small server is measured (point 22), and FR-089b forbids stating a finding about such a server that was not measured.
- **I-a. The command that prints the whole plan.** (a) `zekno settings plan`, beside `zekno settings compose`. (b) `zekno deploy --plan`. **Recommended: (a)**: point 13 compares it to `zekno settings compose`, and it signs nothing; many developers would also read `deploy --plan` as a dry run.
- **I-b. The detail of Railpack's proposed port** (I8). (A) `a default: the app must listen on PORT`, which tells the person what to check. (B) `a default: zekno sets PORT to it`, which says only what zekno does (FR-072a). **Recommended: (B)**: zekno cannot know what the app reads, and an app that listens on 3000 by itself works too; a person from Railway or Heroku knows what PORT means.
- **J-a. The first-time questions in the full-screen app** (B24, B26, H4; A7 is not among them). (a) The app asks them in the panel of "Remember this folder?" (J12). (b) The app says to run `zekno deploy` once in the folder (J11), and deploys from the app after that. In both, a folder with no settings file is sent to the single command (J10), as today's app sends a folder with no Compose file (`app/effects/deploys.ts:210`). **Recommended: (a)**: each is a yes-or-no question, as "Remember this folder?" already is in the app, and a person already in the app should not have to leave it for one yes.

## What the spec leaves unclear

These could not be turned into a line as the spec stands. Each is for the maintainer or the plan.

1. **Which setting names a secret-looking file to send.** FR-015 says such a file is sent when "the settings name it", and FR-007 lists no setting for it. B6, B8, C19 and G8 propose `source.include` (choice G-b).
2. **The proposed `.dockerignore` can leave out what the Dockerfile copies.** Drawn from `.gitignore` (FR-002b), it lists build output such as `dist/`, the very case point 1 chose (a) to keep. The spec does not say whether zekno checks the Dockerfile's `COPY` lines against it, and the question offers only yes or no, not a change.
3. **"No" at the first question ends with today's "No Compose file at …"** (FR-002, A13), where every other question left says `Nothing was done.` A person who just declined to build reads about a Compose file. Put to the maintainer as choice A-c, since (b) changes FR-002.
4. **`zekno settings compose` for a built service.** FR-011 asks for the signed text byte for byte, but the image name holds the build key, made from the code's fingerprint and, for Railpack, the plan. So the command must pack the folder (and run Railpack, with the network), or print text that differs. G22 shows the lines, not which.
5. **What `build.dockerfile` is relative to**: the settings file, or the folder sent. FR-009 says only "relative". C24 and G20 take the folder sent, as Docker, Compose and Railway do.
6. **Railpack cannot make a plan at a first deploy.** Point 14's second way, "set what Railpack needs in the settings, such as a start command", has no settings file to set yet, and `zekno settings init` would need a plan too (I24).
7. **Sentences that need values the runner does not send today.** The busy sentence names the app that is building, its time and its limit (FR-044, E15), and the low-disk refusal names the free space (US9 sc2, R14), but a runner's refusal is one fixed word today (015, R9, R10). Likewise whether a rollback to a build no longer kept is caught by zekno before signing or by the runner (FR-064, G43, which takes the runner).
8. **"The plan changed since the app's last deploy"** (FR-059) needs the last plan. A machine whose history lacks the last deploy, a teammate's, cannot tell. The spec does not say whether the line is then left out.
9. **The full-screen app's questions.** FR-002, FR-015a, FR-015b and FR-037f speak of `zekno deploy` or "a terminal"; the app is one, and the spec does not say whether it asks them (choice J-a), or whether the summary must pause before the app signs (J4 shows it without a pause, as 015's DNS line is shown).
10. **Plain output of a failed build.** US3 sc8 says standard output "keeps today's result line", and a deploy whose app did not start writes nothing on standard output today. E18 takes it so.
11. **`zekno settings init`** offers the build with "the same port question" (FR-011), and nothing says it proposes a `.dockerignore` too (A18 proposes none).
12. **A folder with only `Dockerfile.prod`**, and no file named exactly `Dockerfile`, counts as having none (FR-004): in step 1 it ends with today's sentence, in step 2 it goes to Railpack's question. No line points the person to `build.dockerfile`.
13. **Railpack's default port** (FR-002a, "for Railpack a default") is not given. I8 shows 3000.
14. **Today's sentences that change for apps that do not build.** C26 (SV7), G16 (CS15) and G18 (CS5) are also said to apps that do not build, with no terminal too. FR-074 names only FR-075 and FR-077 as exceptions to plain output staying the same. G18 must change, since it lists the settings. For C26 and G16, the maintainer approves the exception, or today's sentence stays where the service sets no build. J19 is the app's own line, which FR-074 does not cover.
