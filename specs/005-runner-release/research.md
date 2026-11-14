# Research: Runner Releases

Checked on 2026-11-14 on macOS with Bun 1.4.4, gh 2.85.0 and the repository at `e819923`. Decisions
marked **(maintainer)** were made by the maintainer that day. The rest follow from them, from the
code, or from the sources named. Nothing was run on a server or on GitHub.

## R1. Versions and tags **(maintainer: the shape; the rest follows)**

- **Decision**: one grammar, in `packages/core/src/version.ts`:

  ```text
  version = core [ "-dev." count ]
  core    = number "." number "." number
  number  = "0" / nonzero 0*8digit      ; 0, or 1 to 9 digits with no leading zero
  count   = nonzero 0*8digit            ; 1 or more, no leading zero, at most 9 digits
  tag     = "runner-v" version
  ```

  As a regular expression:
  `^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-dev\.[1-9][0-9]{0,8})?$`

  Order: the three numbers compared as numbers, left to right; with the same three numbers a dev
  version is older than the plain one; two dev versions by their count.
  `0.1.0-dev.1 < 0.1.0-dev.2 < 0.1.0-dev.10 < 0.1.0 < 0.1.1-dev.1 < 0.1.1 < 0.10.0`.
- **Rationale**: the decisions ask for "three numbers, or three numbers plus `-dev.<n>`, nothing
  else", and for every check to stay as strict as it can be. A leading zero, `-dev.0`, any other
  suffix, and numbers of 10 digits or more are refused, so each version has one spelling and
  every number fits the shell's `-gt` and JavaScript's exact integers. Feature 004's pattern
  allowed leading zeros; no released version used one.
- **Where a version is checked today** (read in the code), and what changes:

  | Place | Today | Change |
  |-------|-------|--------|
  | `apps/cli/src/install.ts` `VERSION_PATTERN` (check 1 of 3, before a word is placed) | `^[0-9]+\.[0-9]+\.[0-9]+$` | The core grammar |
  | `apps/cli/src/transport.ts` `SCRIPT_WORD` (check 2 of 3) | `^[A-Za-z0-9._~/][A-Za-z0-9._/~-]*$` | None: it already admits `0.1.0-dev.1`. A test says so |
  | Script `is_version` (check 3 of 3) | `case` patterns for three dot-separated parts | The exact grammar in POSIX `sh`, no `${` |
  | Script `is_newer` | three numbers with `cut` | The order above, in `sh` |
  | Script: reading a found runner's version (`sed`) | three numbers | Optional `-dev.<n>`, then `is_version`, else `unknown` |
  | `parseInstallLine`, `runner found <place> <version>` | three numbers | The core grammar |
  | `packages/core/src/protocol.ts` `RunnerVersionSchema` | three numbers | The core grammar |
  | `apps/cli/src/runner-release.ts` schema | three numbers | The core grammar |
  | `apps/cli/src/ops/server.ts` `compareVersions`, `isOutdated` | three numbers | The core order; a relation (older, same, newer) |
  | `.github/workflows/runner-release.yml` tag check | bash `=~` | Moved into `release.ts` with the core grammar |

  The three installer checks stay three: the CLI's pattern, the transport's word check and the
  script's own. The script's `is_newer` is tested against the TypeScript order for every pair of a
  fixed list of versions, in both shells, so the two cannot drift.
- **Alternatives considered**: semantic versioning's full pre-release grammar (allows anything
  after `-`, more than this needs); keeping leading zeros (two spellings of one version).

## R2. The rename 0.2.0 to 0.1.0 **(maintainer)**

- **Decision**: the 54 lines in 20 files outside `specs/` that say `0.2.0` change
  (`git grep -n "0\.2\.0" -- ':!specs/' ':!bun.lock'`). The runner's own version
  (`apps/runner/package.json`) becomes `0.1.0-dev.1` and `runner-release.json` names
  `0.1.0-dev.1` with no checksums, because the first tag is `runner-v0.1.0-dev.1` and the workflow
  requires the two to agree. Tests that used 0.2.0 as "the version this CLI carries" read it from
  `runner-release.json` or inject one, so they pass on `dev` and on `main`. Sentences about a runner
  that reports no version ("from before 0.2.0") say "does not report its version" instead
  (contracts/versions.md). The session protocol number stays 2.
- **Rationale**: a sentence "from before 0.1.0" would be true but would also describe
  `0.1.0-dev.1`, which does report its version.
- **Left as they are**: the records of feature 004 in `specs/004-cli-app/` (what was measured then,
  with the number used then). Open question Q9.
- **Risk found**: a runner built from this repository before this feature says `0.2.0`, which
  counts as newer than every release of this feature. Only the maintainer could have one;
  feature 004's real-server run removed its runner afterwards (specs/004-cli-app/quickstart.md).

## R3. What the Linux builds need (Bun 1.4.4)

Sources: Bun's docs installed with the repository,
`node_modules/.bun/bun-types@1.4.4/node_modules/bun-types/docs/bundler/executables.mdx` ("Supported
targets", "Automatic config loading", "Runtime arguments via `BUN_OPTIONS`") and `docs/installation.mdx`
("CPU Requirements", "Musl Binaries", the Linux note); `bun build --help` on Bun 1.4.4; the Linux
runners built on 2026-11-13 in `apps/runner/dist/` (Bun 1.4.2), read with `file` and `strings`.

- **Targets**: `bun-linux-x64` and `bun-linux-arm64` are the glibc targets
  (`bun-linux-x64-musl`, `bun-linux-arm64-musl` are the others). `bun build --help` does not list
  target names; the docs do.
- **"Baseline" no longer names a separate build.** The docs say: "On x64, Bun ships a single binary
  that targets Nehalem (SSE4.2) and selects AVX2/AVX-512 code paths at runtime. The `-baseline` and
  `-modern` target suffixes are still accepted for backward compatibility and resolve to the same
  binary". So `bun-linux-x64-baseline`, as decided, is accepted and gives the same file as
  `bun-linux-x64`. The decision stands; the release notes describe the floor that binary has.
- **Processor**: x86-64 "Nehalem (1st gen Core) or newer" (Intel), "Bulldozer or newer" (AMD); "Bun
  does not support x64 CPUs without the SSE4.2 extension." ARM64: the docs name no floor; they give
  "Graviton or Raspberry Pi" as examples of where the ARM64 build runs. **Not confirmed**: what a
  Bun binary does on an x86-64 processor without SSE4.2 (a message, or killed by an illegal
  instruction).
- **C library**: "Bun's glibc binaries require glibc 2.17 or newer." The 1.4.2 builds in
  `apps/runner/dist/` agree: the highest `GLIBC_` symbol version in each is `GLIBC_2.17`. Their
  program interpreters are `/lib64/ld-linux-x86-64.so.2` and `/lib/ld-linux-aarch64.so.1`. A task
  checks the same on the 1.4.4 builds.
- **Kernel**: "We recommend kernel version 5.6 or higher. Bun runs on kernels as old as 3.10 (RHEL
  7) with graceful degradation of newer syscalls." The installer does not check the kernel: Docker
  with Compose, which it does check, is the stricter need.
- **What the release notes say about supported servers** (FR-013, FR-022): Linux with the GNU C
  library 2.17 or newer (Debian, Ubuntu, RHEL and similar); x86-64 processors with SSE4.2 (Intel
  Nehalem, AMD Bulldozer or newer); 64-bit ARM; not Alpine or other musl systems. These are what
  Bun documents. Which of them were tried, and how, is added after the proof (SC-007), and nothing
  is listed as tried that was not.
- **Config read at run time (found while reading)**: "Standalone executables can automatically load
  configuration files from the directory where they are run. ... `.env` and `bunfig.toml` loading
  is enabled", and "Standalone executables read the `BUN_OPTIONS` environment variable". Over SSH
  the runner starts in the login user's home folder, so a `~/.env` there would be loaded into its
  environment (for example `ZEKNO_RUNNER_HOME`, which moves its folder, or `DOCKER_HOST`), and a
  `~/bunfig.toml` could preload code. Whoever can write those files already controls that account,
  so this is hardening, not a hole. **Decision (open to the maintainer's veto, Q5)**: build with
  `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`, both listed by `bun build --help`.
  `BUN_OPTIONS` cannot be turned off by a flag; it comes from the server's own environment. The
  same applies to the compiled CLI (`apps/cli/build.ts`) in project folders; it is turned off there
  too (R16).
- **Cross-compiling**: `--compile-executable-path` is described as "Path to a Bun executable to use
  for cross-compilation instead of downloading". **Not confirmed**: where Bun downloads the target's
  runtime from; the installed docs do not say.

## R4. Every limit a 110 MB runner passes

Read in `apps/cli/src/install.ts` and `transport.ts`. The runner is about 110 MB, 49 MB gzipped, on
Bun 1.4.4 (measured by the maintainer).

| Limit | Where | Value | 110 MB runner |
|-------|-------|-------|---------------|
| `RUNNER_FILE_LIMIT`, checked by `stat` and after reading (`--runner-file`) | install.ts | 256 MiB (268,435,456 bytes) | Passes |
| `head -c 268435457` on the file sent (`--runner-file`) | script | 256 MiB + 1 | Passes |
| `curl --max-filesize 268435456` on the `.gz` | script | 256 MiB | Passes (49 MB) |
| `wget` | script | no size limit (feature 004 review, N1) | Passes |
| `gzip -dc ... \| head -c 268435457`, then size `1..268435456` | script | 256 MiB | Passes |
| `download ok <bytes>`: `[1-9][0-9]{0,9}` | install.ts | up to 10 digits | Passes (9 digits) |
| A script line | install.ts | 256 characters | Passes |
| Disk in the runner's folder while installing | script | `.gz` and the unpacked file side by side, then the `.gz` removed | About 160 MB at the peak |

- **Decision**: no limit changes. The disk is the only thing a server can run short of: a download
  or unpacking that fails now checks the free space of the folder and says so (`fail space`,
  contracts/versions.md).

## R5. Who may start a release: a tag ruleset **(maintainer: a ruleset)**

Sources: "Available rules for rulesets", "Creating rulesets for a repository", "About rulesets"
(docs.github.com, Repositories, Managing rulesets); "REST API endpoints for rules"
(docs.github.com/en/rest/repos/rules); "Workflows" (docs.github.com/en/actions/concepts/workflows-and-actions/workflows).

- **Rules**: "Restrict creations: ... only users with bypass permissions can create branches or tags
  whose name matches the pattern you specify." Restrict updates and Restrict deletions work the same
  way. "Block force pushes" is on by default.
- **In Settings**: Settings, Rulesets, New ruleset, **New tag ruleset**; a name; enforcement
  **Active**; Target tags, Add a target, include `runner-v*` (fnmatch); the rules above; Bypass
  list, Add bypass: a role, team or app. "Eligible bypass actors include repository admins,
  organization owners, ..." The page lets the bypass list hold roles, teams and apps, not a
  person by name.
- **Through the REST API**: `POST /repos/{owner}/{repo}/rulesets` with `name`, `target: "tag"`,
  `enforcement: "active"`, `conditions.ref_name.include`, `rules` of types `creation`, `update`
  (with `parameters.update_allows_fetch_and_merge`), `deletion`, and `bypass_actors` with
  `actor_type` (`RepositoryRole`, `User`, ...), `actor_id`, `bypass_mode`. **Not confirmed**: the
  page's examples use `refs/heads/...` and do not show the form of a tag pattern, and it does not
  say which `actor_id` is the admin role. The procedure therefore uses the Settings page.
- **Availability**: `zekno-app/zekno` is a public repository of an organization (`gh repo view`).
  **Not confirmed verbatim**: the page I read says rulesets are for "GitHub Team and GitHub Enterprise
  plans" in one sentence; a search of docs.github.com gives "Rulesets are available in public
  repositories with GitHub Free and GitHub Free for organizations". The Settings page will show it.
- **What it protects and what it does not**: "Each workflow run will use the version of the workflow
  that is present in the associated commit SHA or Git ref of the event." So whoever can push a
  `runner-v*` tag also chooses the workflow that runs, and the workflow's own checks (branch,
  version) are not a boundary against that person. The ruleset is the boundary for who may start
  a release. What any CLI installs is decided by the second build and the checksums the maintainer
  commits, never by the workflow.
- **"Only the maintainer"** holds while the maintainer is the only person with the bypassing role
  (admins of the repository, which on an organization includes its owners). Open question Q8.

## R6. Prod waits for approval: the Environment `prod` **(maintainer)**

Sources: "Deployments and environments" (docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments);
"Managing environments for deployment" (docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments);
"Workflow syntax" (`jobs.<job_id>.environment`).

- "Required reviewers ... only one needs to approve." "Users with GitHub Free plans can only
  configure environments for public repositories." To configure one in an organization repository
  "you must have `admin` access."
- Self-review: "Optionally, to prevent users from approving workflows runs that they triggered,
  select Prevent self-review." The maintainer both pushes the tag and approves, so this stays off.
- Tags: "Selected branches and tags", "Add deployment branch or tag rule", Ref type **Tag**, pattern
  `runner-v*`.
- "By default, administrators can bypass the protection rules"; "Deselect Allow administrators to
  bypass configured protection rules" turns that off. **Recommended**: off, so the approval is never
  skipped by a click.
- "Running a workflow that references an environment that does not exist will create an environment
  with the referenced name." Such an environment has no protection. So `prod` must be created
  (maintainer step 2) before any prod tag.
- "The value of `name` can be an expression" (contexts `github`, `inputs`, `vars`, `needs`, ...).
  **Not confirmed**: what an expression that gives an empty name does. **Decision**: two jobs,
  `release-dev` with no environment and `release-prod` with `environment: prod`, each with an `if:`
  on the `check` job's output. A job that names a protected environment waits for its rules
  before it proceeds, so the prod build and publication happen only after approval (FR-010a).
- **Alternatives considered**: building in a job without write rights and publishing after approval
  in another (needs the artifact actions, which are not in the repository); a `dev` environment
  (not decided, and a dev release has no rule to hold).

## R7. Which branch holds the tagged commit

Sources: actions/checkout README (github.com/actions/checkout); `git merge-base` (git-scm.com/docs/git-merge-base);
"Events that trigger workflows" (docs.github.com).

- "Only a single commit is fetched by default, for the ref/SHA that triggered the workflow." "Set
  `fetch-depth: 0` to fetch all history for all branches and tags."
- "`--is-ancestor`: Check if the first `<commit>` is an ancestor of the second `<commit>`, and exit
  with status 0 if true, or with status 1 if not. Errors are signaled by a non-zero status that is
  not 1."
- For a push, `GITHUB_SHA` is the "Tip commit pushed to the ref". "Events will not be created for
  tags when more than three tags are pushed at once."
- **Decision**: the `check` job checks out with `fetch-depth: 0`, and `release.ts check` runs
  `git merge-base --is-ancestor HEAD origin/dev` for a dev tag and `... origin/main` for a prod tag.
  Status 1 refuses; any other non-zero status is an error. Today `main` is an ancestor of `dev`
  (checked with git), so a commit on `main` is also on `dev`; a dev release from such a commit is
  allowed, a prod release from a commit only on `dev` is not.
- **Decision**: the procedure pushes one tag at a time, never `git push --tags`.

## R8. Publishing, "latest", and replacing files

Sources: `gh release create --help` (gh 2.85.0); "REST API endpoints for releases"
(docs.github.com/en/rest/releases/releases); "Immutable releases" and "Preventing changes to your
releases" (docs.github.com, supply chain security).

- `gh release create`: `--verify-tag` ("Abort in case the git tag doesn't already exist in the remote
  repository"), `--prerelease`, `--latest=false` ("explicitly NOT set as latest"), `--notes-file`,
  `--title`.
- REST: "The latest release is the most recent non-prerelease, non-draft release" and "Drafts and
  prereleases cannot be set as latest." **Decision**: a dev release is created with `--prerelease
  --latest=false`; a prod release with neither.
- **Replacing files**: without immutability, someone with write access can replace a release's
  files. That is caught on the server: the SHA-256 is the CLI's, never the download's (FR-004,
  FR-012). The ruleset also stops the tag from being moved or deleted.
- **Immutable releases** (a repository setting): "Git tags cannot be moved", "All files attached to
  the release ... are protected from modification or deletion", "You can still edit the title and
  release notes of a published immutable release", "If you delete the immutable release, you can
  delete the tag, but you cannot reuse the same tag name", "immutability will only apply to future
  releases", and it generates a release attestation. The decisions exclude attestations in this
  feature, and FR-012 holds without it. **Not decided here**: open question Q1.
- A release that already exists is never replaced: the publish step first runs `gh release view`
  for the tag and stops if it finds one.

## R9. The second build **(maintainer: where and how)**

- **Decision**: `apps/runner/scripts/second-build.ts`, run from the repository as `bun
  apps/runner/scripts/second-build.ts <tag>`. It checks the tag, the branch and the Bun version; resolves the tag's commit
  locally and on GitHub (`git ls-remote`, read only) and requires them equal; builds that commit
  from `git archive` in a temporary folder with `bun install --frozen-lockfile` and the runner's own
  `compile:linux-x64` and `compile:linux-arm64` scripts (so the output names, which the binary
  embeds as `/$bunfs/root/<name>`, are the workflow's); downloads the release's four files from
  the same address servers use; and compares each binary's SHA-256 three ways. Details in
  contracts/second-build.md.
- **What it writes**: only on a full match, `apps/cli/src/runner-release.json`. It prints the record
  and the commands to commit and to add the record to the release notes. It never commits, pushes
  or edits the release.
- **Independence, and its limits**: the build runs on another machine, another operating system,
  with its own Bun and its own copy of the source, so GitHub's build service cannot change the
  result unseen. Both builds fetch the same packages from npm and the same Bun runtimes, so a
  problem there would be in both and would match. Written in RELEASING.md and the docs.
- **Measured by the maintainer on 2026-11-14**: two builds of one commit on one machine are byte
  for byte identical when the output file name is the same. **Unknown**: GitHub's Linux build
  against a macOS build (plan.md, "If GitHub's build differs").
- **Where its record lives**: open question Q3.

## R10. Keeping `main` free of a dev version

- **Decision**: four layers (plan.md): the second build records a dev release only on `dev` and a
  prod release only on `main`; the prod versions are committed on `dev` before the merge, and
  `release.ts check-main` is run before pushing `main`; a new workflow, `main-versions.yml`, runs
  `check-main` on pushes to `main` and pull requests into it; a prod tag is refused when its
  commit's `runner-release.json` names a dev version.
- **Rationale**: the decisions ask for a test or a check in CI. There is no CI today besides the
  release workflow, so a test alone would only run when someone runs the tests on `main`.
- **Alternatives considered**: a branch-aware unit test (it cannot know the branch reliably on a
  detached checkout); a required status check on `main` (a setting, and it changes how `main` is
  pushed; not proposed).

## R11. Withdrawing a release **(maintainer: the smallest procedure)**

- **Decision**: on each branch that carries the release, a commit that sets both checksums in
  `runner-release.json` to `null` (version unchanged). A CLI built from it then says it has no
  published runner to install (FR-007). Then the GitHub release is marked or deleted (open question
  Q2), the tag is kept, and the version is never used again. Servers that already run it keep
  running; nothing on them changes. The fix is a new release with a higher version, recorded as
  usual, then `zekno server update` on each server. If a server must stop using it at once, the
  runner is replaced by hand as the runner's README describes.
- **Why not go back to the previous release's checksums**: there is none for the first release, and
  `zekno server update` never replaces a newer runner, so an older recorded release would not reach
  the servers that have the withdrawn one.

## R12. What a server lacks, said before anything is put in place

- **Decision**: in the script, before downloading: a server whose `getconf GNU_LIBC_VERSION` prints
  `glibc <x.y>` below 2.17, or whose `ldd --version` names musl, stops with `fail libc`. After the
  download and the checksum, when the new runner does not answer `version` from the temporary
  folder: exit status 127, or `GLIBC_` in what it wrote on standard error, stops with `fail libc`;
  exit status 132 (killed by an illegal instruction) stops with `fail cpu`; anything else stays
  `fail version`. In each case the first line it wrote on standard error is passed on (cleaned by
  the CLI as all standard error is). The checksum tool is looked for before the download, so a
  server without one downloads nothing. A failed download or unpacking reports `fail space` when
  the folder has less than 256 MiB free (`df -Pk`). Nothing is put in place in any of these cases.
- **Rationale**: these checks use commands the tests can stand in for (`getconf`, `ldd`, `df`, a fake
  runner's exit status), unlike fixed paths such as `/proc/cpuinfo` or the loader's path. The
  after-the-download diagnosis reads what actually happened. The words added are three `fail`
  reasons (`libc`, `cpu`, `space`); no value from the server is placed into the script.
- **Alternatives considered**: checking `/proc/cpuinfo` for `sse4_2` and the loader's path (cannot
  be tested on the machines the tests run on); a check of the kernel version (Docker's own need is
  stricter).

## R13. Telling a person about the runner's version

- **Decision**: older, same, newer and "does not report its version" each have their sentence, with
  what does not work until the runner is updated decided by whether the runner speaks sessions and
  by its protocol number (contracts/versions.md). A dev version facing a plain one adds one short
  sentence. On Home, the line under a server becomes `! older runner` or `! newer runner`, which
  fit the 16 columns the pane has at 80 columns (a dev version such as `0.1.0-dev.1` does not fit
  beside "runner").
- **Rationale**: FR-018 asks for both older and newer; today only older is said. FR-021 asks to say
  what does not work, and "Running state and logs need the newer runner" is only true of a runner
  without sessions.
- **Needs the maintainer's approval** before it is built (open question Q4): it changes the wording
  of screens approved in feature 004.

## R14. The procedure page

- **Decision**: `apps/runner/RELEASING.md` (plan.md, "The release procedure page").

## R15. Testing

- **Decision**: `bun test` as now. The script under `/bin/sh` and `/bin/dash` against the stand-ins
  of `apps/cli/test/stand-in-server.ts`, extended with stand-in `getconf`, `ldd` and `df`. The
  release script against temporary repositories with a bare `origin` (no network). The second build
  with a stand-in download and a stand-in build (no network); its real build path once, by hand,
  recorded in quickstart.md. The agent end-to-end tests (`bun run test:e2e`) stay as they are unless
  a screen they read changes wording; refreshing their replay cache costs the maintainer a little
  and is one task near the end, with the maintainer's go-ahead.

## R16. A compiled program reads its working folder's `.env` and `bunfig.toml` (found 2026-11-14)

Sources: Bun's installed docs, `docs/bundler/executables.mdx`, "Automatic config loading"; the types in
`node_modules/.bun/bun-types@1.4.4/node_modules/bun-types/bun.d.ts`, `CompileBuildOptions`; `bun build --help`
on Bun 1.4.4. Reproduced on this machine (macOS, Bun 1.4.4).

- **What happens**: a program built with `bun build --compile` (or `Bun.build` with `compile`) loads
  `.env` into its environment and reads `bunfig.toml`, including its `preload` scripts, from the
  folder it is started in, unless it was built not to. In a folder holding `bunfig.toml` with
  `preload = ["./evil.ts"]` and a `.env`, the runner and the CLI as built at `2d6f155` ran `evil.ts`
  and took the variables from `.env` (`ZEKNO_RUNNER_HOME` for the runner, `ZEKNO_HOME` for the
  CLI). Built with the autoloads off, neither did.
- **Why it matters**: the runner starts in the login user's home folder over SSH (R3). The CLI is
  started inside project folders, which may be cloned from strangers: such a folder could run code
  in `zekno`, or point it at a profile of its own, before anything is asked.
- **Decision**: both programs are built with the autoloads off. The runner's three compile scripts
  pass `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (T002, Q5 as recommended).
  `apps/cli/build.ts` passes `autoloadDotenv: false` and `autoloadBunfig: false` to `Bun.build`, the
  JavaScript API's names for the same two flags. `tsconfig.json` and `package.json` are not read at
  run time by default (`--compile-autoload-tsconfig` and `--compile-autoload-package-json` are off
  unless given); the runner's scripts give neither, and `build.ts` sets `autoloadTsconfig: false` and
  `autoloadPackageJson: false` so it stays so.
- **Tested**: `apps/runner/test/compiled.test.ts` and `apps/cli/test/compiled.test.ts` compile each
  program once into a temporary folder and start it in a folder holding such a `.env` and
  `bunfig.toml`: the preload's marker is never written, `version` and `--help` answer as usual, and
  the folder `.env` names is not used. Each test also runs the program from source in the same
  folder, where Bun does read both, so the folder is one Bun would act on. With the flags taken
  out, three of each file's four tests fail.
- **Not changed**: a program run from source (`bun apps/cli/src/main.ts`, `bun apps/runner/src/main.ts`)
  reads `.env` and `bunfig.toml` from the folder it is started in, preloads included. That is Bun's
  own behaviour for a development checkout. `BUN_OPTIONS` in the environment is read by a compiled
  program too and cannot be turned off; it comes from the user's own environment.

## Open questions for the maintainer

Each has a recommended answer. The plan and tasks work with the recommendation; a different answer
changes only the tasks named.

| # | Question | Recommended answer | Tasks it touches |
|---|----------|--------------------|------------------|
| Q1 | Turn on immutable releases for the repository? It stops files and tags from being changed after publishing, keeps notes editable, makes a deleted release's tag unusable again, and makes GitHub generate a release attestation, which the decisions left out of this feature. | No, not in this feature. FR-012 holds without it (the CLI's checksum). Revisit with provenance later. | None; RELEASING.md mentions it as not enabled |
| Q2 | When withdrawing: mark the GitHub release (title and notes say "Withdrawn") or delete it? | Delete it, keep the tag. A CLI built before the withdrawal still holds the checksums; with the files gone it cannot install the release at all. Never reuse the version. | T030 (RELEASING.md) |
| Q3 | Where does the second build's record live "with the release" (FR-009)? | Added by the maintainer to the release notes (`gh release edit <tag> --notes-file <record>`; notes stay editable on any release), and quoted in the body of the commit that records the checksums. | T016, T030 |
| Q4 | Approve the wording of contracts/versions.md: the sentences for older, newer and dev runners, `! older runner` and `! newer runner` on Home in place of `! runner 0.1.0`, the add-server details, and the installer's three new failure sentences and the changed `tools` one? | Approve as written. | T019, T021 to T024, T027; possibly T038 |
| Q5 | Build the runner with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (R3)? It changes the binary, so it must be decided before the first release. | Yes. | T002 |
| Q6 | After a prod release, merge `main` back into `dev` and push `dev`, so the next merge does not conflict on the two version files? | Yes, as the last part of step 7. | RELEASING.md (T030) |
| Q7 | After step 7, a short proof with the prod CLI on the server that runs `0.1.0-dev.1`: `zekno status` says it is older, `zekno server update` brings it to `0.1.0`, a deploy works. It is the real dev-to-prod case. | Yes, as a step 8 with your go-ahead. | T042 |
| Q8 | Who else holds the admin role on `zekno-app/zekno` (organization owners included)? Is there a second GitHub account with write access to try pushing a `runner-v*` tag for SC-006? | Make the maintainer the only admin. For SC-006, invite a throwaway account with Write role, try `git push origin runner-v0.0.1-dev.1` from it, record the refusal, remove it. Without one, record SC-006 as not tried. | Step 1, T041 |
| Q9 | FR-016a says "everywhere". Change the records in `specs/004-cli-app/` too? | No. They record what was run, with the number used then. | T008 |
| Q10 | README promises "A dedicated contact address will be listed here before the first release." The runner release is a first release. Supply an address, or turn on GitHub's private vulnerability reporting and point to it? | Turn on private vulnerability reporting (a repository setting) and say so in the README before step 3. | T035 |
