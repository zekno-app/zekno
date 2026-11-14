# Releasing the runner

This page takes a maintainer through a runner release, from start to end, with no other help. It
is the procedure behind every release of `zekno-runner`, the first one included. A release takes
under an hour, most of it waiting for builds.

There are two kinds of release:

| | dev | prod |
|---|---|---|
| Tag | `runner-v<x.y.z>-dev.<n>`, such as `runner-v0.1.0-dev.1` | `runner-v<x.y.z>`, such as `runner-v0.1.0` |
| Cut from | a commit on `dev` | a commit on `main` |
| On GitHub | a pre-release, never the latest release | a release |
| Approval | none | the maintainer approves it before anything is published |
| Installed by | a zekno built from `dev` | a zekno built from `main` |

A dev release is for proving a runner on a real server before the prod release of the same
version.

Steps marked **[outward]** change something on GitHub: a setting, a push, a tag, a release or a
workflow run. Each is the maintainer's own, done by hand, at the time. Everything else only reads,
or changes this machine.

## In short

A dev release:

1. Once: part 1.
2. The version on `dev` (parts 2 and 3).
3. Tag the commit and push the tag (part 5). Watch the run (part 6).
4. The second build on `dev`, and the commands it prints (part 7). The notes (part 8).

A prod release:

1. Once: part 1.
2. The prod versions on `dev`, merged into `main`, and the environment `prod` checked (part 4).
3. Tag the commit and push the tag (part 5). Approve the run (part 6).
4. The second build on `main`, and the commands it prints (part 7). The notes (part 8).
5. Merge `main` back into `dev`, then a short proof with the prod release (part 10).

The first releases are `0.1.0-dev.1`, then `0.1.0`. Both version files on `dev` already name
`0.1.0-dev.1`. Between the two, the dev release is proven on a real server, as
[`specs/005-runner-release/quickstart.md`](../../specs/005-runner-release/quickstart.md), section 7,
describes.

The commands below use two shell variables. Set them in the terminal you release from. Write the
version of this release in place of `<version>`, such as `0.1.0-dev.1`:

```sh
unset VERSION TAG
VERSION=<version>
TAG="runner-v${VERSION:?}"
```

`unset` clears what an earlier release left in this terminal. Until `<version>` is replaced, the
second line is not a command any shell runs, and the third stops with an error that names
`VERSION`. Every command below writes them as `${VERSION:?}` and `${TAG:?}`, so it stops the same
way instead of acting on an empty or an older version.

## 1. Once, before the first release

These are settings of the repository on GitHub. Only someone with the admin role can change them.
Make them before any release tag is pushed. GitHub moves its settings pages now and then: the
names in bold are what to look for.

### The tag ruleset

It decides who may start a release: whoever can push a `runner-v*` tag starts one, and also
chooses the workflow that runs for it. Without the ruleset, anyone with write access can do that.

1. **[outward]** On `github.com/zekno-app/zekno`: **Settings**, **Rules**, **Rulesets**, **New
   ruleset**, **New tag ruleset**.
2. Name it `runner release tags`. Enforcement status: **Active**.
3. Target tags: **Add target**, **Include by pattern**, `runner-v*`.
4. Rules: tick **Restrict creations**, **Restrict updates**, **Restrict deletions** and **Block
   force pushes**.
5. Bypass list: **Add bypass**, the **Repository admin** role. Nothing else.
6. **Create**.
7. Check who holds the admin role: **Settings**, **Collaborators and teams**, and the
   organization's owners (the organization's **People**, role **Owner**). Each of them can push a
   release tag. The maintainer must be the only one.

To prove it, when another account that has the Write role and nothing more is at hand, from that
account **[outward]** `git push origin runner-v0.0.1-dev.1` must be refused by GitHub. Without such
an account this is not tried. Either way, write down whether it was tried.

### The rules for `dev` and `main`

A release is checked against these two branches. The workflow and the second build look for the
tagged commit on them, and `apps/cli/src/runner-release.json` on each decides what every zekno
built from it installs.

1. **[outward]** **Settings**, **Rules**, **Rulesets**, **New ruleset**, **New branch ruleset**.
2. Name it `release branches`. Enforcement status: **Active**.
3. Target branches: **Add target**, **Include by pattern**, `dev`. Again for `main`.
4. Rules: tick **Restrict deletions**, so that neither branch can be deleted and made again with
   other commits, and **Block force pushes**, so that a commit once on a branch stays on it, and a
   release cut from it can always be traced to it.
5. Bypass list: **Add bypass**, the **Repository admin** role. Nothing else.
6. **Create**.

Then a second branch ruleset, for `main` only:

1. **[outward]** **New ruleset**, **New branch ruleset**. Name it `main versions`. Enforcement
   status: **Active**. Target branches: **Include by pattern**, `main`.
2. Rules: tick **Require status checks to pass** and add the check `check-main`: the job of the
   workflow `main versions` (`.github/workflows/main-versions.yml`). Type the name if it is not
   offered. A commit then reaches `main` only once that check has passed on it, for example in a
   pull request, so `main` does not carry a development version. Without this rule the workflow
   only reports (part 4).
3. Bypass list: the **Repository admin** role. Nothing else. The maintainer's own push to `main`
   is therefore not held by it: that is why part 4 runs the same check before pushing `main`.
4. **Create**.

These rules do not stop a push to `dev` or `main` by someone with write access, or by the release
workflow's own token while a publish job runs. That token can write only in the publish jobs,
which run nothing of the repository, of its packages or of what the build handed on (part 6).

### The environment `prod`

A prod release's publish job waits in it for the maintainer's approval before anything is
published. Its build runs before, with a token that cannot write.

1. **[outward]** **Settings**, **Environments**, **New environment**, name `prod`, **Configure
   environment**.
2. Tick **Required reviewers** and add the maintainer. Leave **Prevent self-review** unticked: the
   maintainer both pushes the tag and approves it.
3. Untick **Allow administrators to bypass configured protection rules**, so the approval is never
   skipped.
4. **Deployment branches and tags**: **Selected branches and tags**, **Add deployment branch or tag
   rule**, Ref type **Tag**, name pattern `runner-v*`.
5. **Save protection rules**.

It must exist before the first prod tag is pushed. A workflow that names an environment that does
not exist creates it, with no protection, and the release would be published with nobody
approving it. Part 4 checks it before each prod tag.

### How long a run keeps its files

The build job hands the release's files to the publish job as an artifact of the run, kept 1 day
for a dev release and 30 days for a prod release, the longest a prod release can wait for its
approval. A repository can keep artifacts for less than an artifact asks. Check **Settings**,
**Actions**, **General**, **Check, workflow run, status, artifact and log retention**: it must be at
least 30 days. GitHub's default is 90. If it is lower, **[outward]** set it to 90.

### Security reports

**[outward]** **Settings**, the **Security** section (**Advanced Security**), **Private
vulnerability reporting**, **Enable**, if it is not enabled already. The README's "Reporting a
vulnerability" points there.

### Left off: immutable releases

**Settings**, **General**, **Releases**: release immutability stays off. It would stop a release's
files and tag from changing, and make GitHub publish an attestation, which this feature leaves out.
A changed file is caught without it: a server checks every download against the checksum zekno
holds.

## 2. Which commits

- A dev release is cut from a commit on `dev`. A prod release is cut from a commit on `main`.
- "On" means on the branch as GitHub has it: push the branch before the tag.
- The tag goes on the branch's latest commit, once its tests pass.
- The workflow refuses any other commit, with
  `<tag> is a dev release, so its commit must be on dev. Commit <12 hex> is not on origin/dev.`
  (or `prod` and `main`). A commit of `main` that was merged into `dev` is on both, so a dev
  release can be cut from it.
- The second build refuses it too, against the branch as your own checkout has it (part 7).

## 3. The version

- A version is three numbers, or three numbers and `-dev.<n>`: `0.1.0`, `0.1.0-dev.1`. No leading
  zeros, no other ending, at most nine digits in each number. Exactly:
  `^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-dev\.[1-9][0-9]{0,8})?$`
- A dev version is older than the plain version with the same three numbers:
  `0.1.0-dev.1`, then `0.1.0-dev.2`, then `0.1.0`. Dev releases count from 1.
- Choosing it: another dev release of the same version takes the next count. A new version
  raises the third number for fixes only, and the second number otherwise.
- A version is used once. Once its tag is pushed, the tag is never moved or deleted and the version
  is never pushed again, even when the run failed or the release was withdrawn. The next try takes
  the next number.
- `apps/runner/package.json` must say the version in the tagged commit: the workflow checks it,
  and checks that the built runner answers with it.

To set it on `dev`:

```sh
git switch dev
git pull --ff-only origin dev
```

In `apps/runner/package.json`, set `"version"` to the version. Then:

```sh
git diff
bun run typecheck
bun run lint
bun run test
git add apps/runner/package.json
git commit -m "chore(runner): version ${VERSION:?}"
```

**[outward]** `git push origin dev`

## 4. Preparing a prod release

Only for a prod release. `main` must never carry a dev version: a zekno built from `main` installs
prod releases only. So the prod versions are committed on `dev` first, then merged into `main`.
Write the prod version in place of `<version>`, such as `0.1.0`:

```sh
unset VERSION TAG
VERSION=<version>
TAG="runner-v${VERSION:?}"
git switch dev
git pull --ff-only origin dev
```

In `apps/runner/package.json`, set `"version"` to the version. Then write
`apps/cli/src/runner-release.json` with the same version and no checksums:

```sh
cat <<EOF > apps/cli/src/runner-release.json
{
  "version": "${VERSION:?}",
  "files": {
    "linux-x64": {
      "sha256": null
    },
    "linux-arm64": {
      "sha256": null
    }
  }
}
EOF
git diff
bun run typecheck
bun run lint
bun run test
git add apps/runner/package.json apps/cli/src/runner-release.json
git commit -m "chore: prod versions for runner ${VERSION:?}"
```

**[outward]** `git push origin dev`

Then on `main`:

```sh
git switch main
git pull --ff-only origin main
git merge --no-ff --no-edit dev
bun apps/runner/scripts/release.ts check-main
```

`check-main` must print
`No development version: apps/runner/package.json holds <version>, apps/cli/src/runner-release.json holds <version>.`
If it names a file instead, stop: fix it on `dev` and merge again.

**[outward]** `git push origin main`

The workflow `main versions` runs the same `check-main` on GitHub. It reports; it does not stop a
push on its own. It runs once the push is made, a commit message with `[skip ci]` skips it, and a
push made with a workflow's token does not start it. The rule for `main` in part 1 makes it a
required check, but not for the admins. So the `check-main` you ran here is what keeps a dev
version off `main`.

Then check the environment `prod` as GitHub has it, before each prod tag. Both commands only read:

```sh
gh api repos/zekno-app/zekno/environments/prod --jq '{deployment_branch_policy, reviewers: [.protection_rules[] | select(.reviewers != null) | {prevent_self_review, logins: [.reviewers[].reviewer.login]}]}'
gh api repos/zekno-app/zekno/environments/prod/deployment-branch-policies --jq '[.branch_policies[] | {name, type}]'
```

The first must show `deployment_branch_policy` with `custom_branch_policies` true and
`protected_branches` false, and one entry under `reviewers` with `prevent_self_review` false whose
`logins` hold the maintainer's GitHub login. The second must show one policy, `name` `runner-v*`
and `type` `tag`, and nothing else. If either command fails, for example with `HTTP 404`, or shows
anything else, push no prod tag: make `prod` as part 1 says and check again. Whether
administrators may bypass its rules is not in these answers: check on the environment's settings
page that **Allow administrators to bypass configured protection rules** is unticked.

From here until part 7 is done, a zekno built from `dev` or `main` holds no checksums, and says it
has no published runner to install. That is expected.

## 5. Starting a release

The one action that starts a release is pushing its tag. First make the tag here, on the right
commit, and run the workflow's own checks against it:

```sh
git switch dev
git pull --ff-only origin dev
git log -1 --format='%H %s'
git tag -a "${TAG:?}" -m "zekno-runner ${VERSION:?}"
bun apps/runner/scripts/release.ts check --tag "${TAG:?}"
```

For a prod release, use `main` in place of `dev` in the first two commands. Keep the commit and
the subject `git log` printed: the second build names them (part 7).

`check` prints four lines, `environment=`, `version=`, `commit=` and `bun=`, or one sentence that
says what is wrong. When it refuses, the tag was never pushed, so the version is still unused:
remove the tag with `git tag -d "${TAG:?}"`, fix what it said, and make the tag again.

**[outward]** `git push origin "${TAG:?}"`

Push this one tag, never `git push --tags` and never several tags at once. GitHub starts no
workflow when more than three tags are pushed together, and any other tag pushed by mistake would
start a release of its own.

## 6. Watching the run, and approving a prod release

The workflow is `.github/workflows/runner-release.yml`. Find its run:

```sh
gh run list --repo zekno-app/zekno --workflow runner-release.yml --limit 3
gh run watch <run id> --repo zekno-app/zekno --exit-status
```

Or open **Actions**, **runner release** on GitHub.

| Job | What it checks and does |
|-----|-------------------------|
| `check` | The tag is `runner-v<version>`. The checked-out commit is the tag's. That commit is on `origin/dev` (dev) or `origin/main` (prod). `apps/runner/package.json` says the version. The root `package.json` pins Bun. For prod, `apps/cli/src/runner-release.json` names no dev version. Then it hands on the environment, the version, the commit and the Bun version. |
| `build-dev` or `build-prod` | First, before anything is checked out, checks that the tag itself is of its kind, dev or prod. Reads the pinned Bun version from the commit, installs the packages without running their install scripts, and builds the runner for Linux on x86-64 and ARM64 with that Bun. Checks that it builds the commit `check` passed, that both runners were built, each at most 256 MiB, and that the x86-64 runner answers with the version. Writes the two `.gz` files, `SHA256SUMS` and `RELEASE-NOTES.md`, prints the checksums, and hands the four files on as the run's artifact `runner-release`. It can read the repository and not write to it. |
| `publish-dev` or `publish-prod` | First checks that the tag itself is of its kind, and takes the version from it. Downloads the artifact. Checks that exactly the four files are there, each within its size (the notes at most 64 KiB), and that the two runners unpack to what `SHA256SUMS` says. Stops if a release for the tag exists already. Publishes with `gh`: a dev release as a pre-release that is never the latest. It checks out nothing, installs nothing, and runs nothing of the repository or of the files it was handed. `publish-prod` waits for your approval before its first step. |

The token GitHub gives the workflow can write only in `publish-dev` and `publish-prod`, and only
their publishing step names it. Every checkout keeps none of it. The packages, the build and the
built runner run only in the build jobs, which cannot write. A build can still hand on files other
than its source makes; they would be published, and no zekno would install them: the second build
(part 7) compares them with its own.

Nothing is published when any step fails. Read why with
`gh run view <run id> --repo zekno-app/zekno --log-failed`. When it failed for a passing reason,
such as the network, run the failed jobs again: **[outward]**
`gh run rerun <run id> --repo zekno-app/zekno --failed`. It builds the same tag and commit, and
publishes nothing twice. A publish job run again needs the artifact its build handed on, which is
kept 1 day for dev and 30 days for prod. What GitHub does with the artifact of an earlier attempt
has not been tried: if the run fails again at the upload or the download, or when the commit itself
is at fault, the version is used. Fix the cause and take the next number (part 3).

**Approving a prod release.** `build-prod` runs first, without approval; then `publish-prod` waits
for review before its first step. Before you approve, check that the run names your tag and the
commit that `git rev-parse "${TAG:?}^{commit}"` prints here, and that `build-prod` passed. Its log
shows the checksums of the two runners it built. Then, on the run's page: **[outward]** **Review
deployments**, tick **prod**, **Approve and deploy**. **Reject** publishes nothing. An approval may
wait up to 30 days; after that GitHub fails the run, nothing is published, and the version is used.

When the run has passed:

```sh
gh release view "${TAG:?}" --repo zekno-app/zekno
```

It lists four files: `zekno-runner-linux-x64.gz`, `zekno-runner-linux-arm64.gz`, `SHA256SUMS` and
`RELEASE-NOTES.md`. A dev release is marked as a pre-release.

No zekno installs the release yet. That waits for the second build.

## 7. The second build

The second build is the only way checksums get into zekno. It runs on your own machine, so
GitHub's build service cannot change the runner without the difference being seen.

It needs the Bun version the root `package.json` pins, the network, and a few minutes. It
downloads the release's files and Bun's two runtimes for Linux, about 107 MB each unpacked, and
any npm package `bun.lock` names that Bun's cache on this machine lacks. Run it on the branch the
release is recorded on: `dev` for a dev release, `main` for a prod release. Pull that branch
first: the tagged commit must be on it as your checkout has it.

```sh
git switch dev
git pull --ff-only origin dev
git status --short apps/cli/src/runner-release.json
bun --version
bun apps/runner/scripts/second-build.ts "${TAG:?}"
```

For a prod release, use `main` in place of `dev` in the first two commands. `git status` must
print nothing.

It checks the tag, the branch, that `apps/cli/src/runner-release.json` has no change of its own
and records nothing newer, that the tagged commit is on the branch here, that the tag here and on
GitHub is the same commit, that Bun is the pinned version, and that the commit builds this
version. Nothing of a commit that is not on the branch is downloaded or built. It downloads the
release's four files from the address servers use, over HTTPS only. It builds the tagged commit
from `git archive` in a temporary folder, with `bun install --frozen-lockfile --ignore-scripts`, as
the workflow installs, and the runner's own compile scripts. The build is given only `HOME`,
`PATH`, and a temporary folder and a folder for Bun's runtimes of its own, which starts empty, so
Bun downloads the runtimes again instead of using copies already on this machine. Other variables
of your terminal, such as `BUN_OPTIONS` or a proxy, do not reach it. Then it compares each binary
three ways: its own build, the downloaded file, and the line of `SHA256SUMS`.

**When all agree**, it writes the checksums into `apps/cli/src/runner-release.json`, prints the
record, `Second build of <tag> (<dev|prod>): matched.`, the commit and its subject, and a table,
then:

```text
Recorded runner <version> in apps/cli/src/runner-release.json. Next, on <branch>:
  git add apps/cli/src/runner-release.json
  git commit -F <commit message file>
  git push origin <branch>
  gh release edit <tag> --repo zekno-app/zekno --notes-file <notes file>
```

It runs none of them. First compare the commit and the subject in the record with those `git log`
printed when you made the tag (part 5). If they differ, stop: run none of the commands, undo the
change with `git restore apps/cli/src/runner-release.json`, and decide with the maintainer, as for
a file that differs (below). If they are the same, run the first two commands as printed. The
commit message holds the record. Add the "Tried on" section to the notes file (part 8).
Then **[outward]** run the `git push` and **[outward]** the `gh release edit` as printed.

From that commit on, a zekno built from the branch installs the release.

**When it stops**, its exit status says why:

| Status | Meaning | What to do |
|--------|---------|------------|
| 1 | Something did not match: a file, the commit, the version, `SHA256SUMS` or the notes. Or the tagged commit is not on the branch here. | For a commit not on the branch: pull the branch and run it again. If it says so again, the release was not cut from the branch: record nothing, and decide with the maintainer. Otherwise, below. |
| 2 | A condition on this machine: the wrong branch, a change in `apps/cli/src/runner-release.json`, another Bun, no tag here, or a newer release already recorded. | Do what its sentence says. A tag you made on another machine can be fetched with `git fetch origin tag "${TAG:?}"`. Its commit must then be on the branch here, as for any tag. |
| 3 | It could not finish: the network, the build, or another failure that is none of its checks, such as a program that could not start. Its sentence says whether it had compared anything. | Fix what it names and run it again. |

Nothing is written to `apps/cli/src/runner-release.json` with status 1 or 2, or with status 3
before the comparison. After the comparison, status 3 says so: check that file with `git diff`
before you commit anything.

**When a file differs** (status 1), it names each file that differs with its three checksums,
keeps its build and the downloaded files in a folder it names, and writes the notes with the
record of the mismatch. No zekno installs that release. Then:

1. Stop. Record nothing by hand. Never change the comparison, the build or this rule to make them
   agree.
2. **[outward]** Put the record in the release notes:
   `gh release edit "${TAG:?}" --repo zekno-app/zekno --notes-file <the notes file it names>`.
3. Decide with the maintainer what comes next (`specs/005-runner-release/plan.md`, "If GitHub's
   build differs from the maintainer's"). Keep the folder it named until then.

**What both builds share.** The second build runs on another machine, with its own copy of the
source and its own Bun, so it shows that GitHub's build service changed nothing. Both builds
fetch the same npm packages, pinned by `bun.lock` with their checksums, and the same Bun runtimes
for Linux, from the same places. A problem in those would be in both builds, and they would still
match. Neither build checks the runtimes against Bun's own published checksums: that stays an open
note (`specs/005-runner-release/research.md`, Q12).

## 8. The release notes

The workflow writes `RELEASE-NOTES.md` and makes it the release's text: the version, the commit,
the Bun version, "Pre-alpha and unaudited", for a dev release a paragraph saying so, what the
runner is built for, the checksums, and "Second build: Not made yet."

After the second build, two things are added, in the notes file the second build wrote:

- The second build's record, in place of "Not made yet.". The second build puts it there, as it
  puts it in the commit that records the checksums.
- A section "Tried on": what was run where, and what was not. Nothing is listed as tried that was
  not.

```markdown
## Tried on

- <date>: <what was run> on <Linux system>, <x86-64 or ARM64>, <as root or as another user>: <result>.
- Not tried: <what was not, and what stood in for it>.
```

**[outward]** `gh release edit "${TAG:?}" --repo zekno-app/zekno --notes-file <notes file>`

The notes can be edited again at any time, for example once a proof on a real server is done. A
release's files are never replaced.

## 9. Withdrawing a release

When a release turns out to be bad, these steps stop zekno from installing it, within the limits
below. The GitHub release is deleted, its tag is kept, and its version is never used again.

1. On each branch that records it, write `apps/cli/src/runner-release.json` with the same version
   and no checksums. A dev release is recorded on `dev`. A prod release is recorded on `main`, and
   on `dev` too once `main` was merged back (part 10). On `dev`, with the version being withdrawn in
   place of `<version>`:

   ```sh
   unset VERSION TAG
   VERSION=<version>
   TAG="runner-v${VERSION:?}"
   git switch dev
   git pull --ff-only origin dev
   cat <<EOF > apps/cli/src/runner-release.json
   {
     "version": "${VERSION:?}",
     "files": {
       "linux-x64": {
         "sha256": null
       },
       "linux-arm64": {
         "sha256": null
       }
     }
   }
   EOF
   git diff
   git add apps/cli/src/runner-release.json
   git commit -m "chore(cli): withdraw runner ${VERSION:?}"
   ```

   **[outward]** `git push origin dev`, and the same on `main` for a prod release.
2. **[outward]** Delete the GitHub release and keep its tag:
   `gh release delete "${TAG:?}" --repo zekno-app/zekno`. It asks before it deletes: check that
   it names the release you are withdrawing. Never add `--cleanup-tag`.
3. Delete the workflow runs of its tag, so that none can be run again and publish it anew.
   `gh run list --repo zekno-app/zekno --workflow runner-release.yml --limit 20` lists the runs;
   those of the tag show it as their branch. **[outward]** Delete each with
   `gh run delete <run id> --repo zekno-app/zekno`.
4. The version is never used again (part 3). The fix is a new release with the next version,
   recorded as usual.

**What it does.** A zekno built from the commit of step 1, or later, does not install the release:
it says it has no published runner to install. A zekno built before step 1 still holds the
checksums. With the files gone (step 2), a server it asks stops at the download, says it could not
download the runner, and installs nothing. A server half way through a download stops the same
way, with nothing put in place.

**What it does not do.** It does not stop a zekno built before step 1 for good. Anyone with write
access to the repository can create a release again on the kept tag with the original files,
which anyone could have downloaded while they were public. Such a zekno then installs it again,
because the checksums it holds match. Running the release's workflow run again would do the same,
which step 3 prevents. Whether immutable releases, which stay off (part 1), would stop a release
from being created again on a kept tag is not known. And it changes nothing on servers that already run it.

**Servers that already run it** keep running it: nothing on them changes. Once the next release is
recorded, `zekno server update <name>` replaces it on each, because the next version is newer.
`zekno server update` never puts an older version in place. If a server must not start it again
before then, remove it from the server by hand: `/usr/local/bin/zekno-runner` when zekno logs in
as root, `~/.local/bin/zekno-runner` otherwise. The runner runs only when zekno starts it, so the
apps keep running, and its folder stays as it is. Put a good runner there by hand once there is
one ([README](./README.md), "By hand").

## 10. After a prod release

1. Merge `main` back into `dev`, so `dev` records the prod release too and the next merge into
   `main` does not conflict on the two version files:

   ```sh
   git switch dev
   git pull --ff-only origin dev
   git merge --no-ff --no-edit main
   ```

   **[outward]** `git push origin dev`
2. Last, a short proof on a real server: with a zekno built from `main`, on a server that runs the
   dev release of the same version, `zekno status` says the runner is older,
   `zekno server update <name>` brings it to the prod release, and a deploy works. Add what was run
   to the release notes' "Tried on" (part 8).

The next dev release then sets its version on `dev` (part 3), such as `0.1.1-dev.1`.
