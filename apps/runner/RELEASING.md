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
| Approval | none | the maintainer approves it before anything is built |
| Installed by | a zekno built from `dev` | a zekno built from `main` |

A dev release is for proving a runner on a real server before the prod release of the same
version.

Steps marked **[outward]** change something on GitHub: a setting, a push, a tag or a release.
Each is the maintainer's own, done by hand, at the time. Everything else only reads, or changes
this machine.

## Waiting for the maintainer's answer

These parts follow the recommended answers to open questions in
[`specs/005-runner-release/research.md`](../../specs/005-runner-release/research.md). Each place is
marked with its question, such as **[Q2]**. Remove this list and the marks once each is answered.

- **[Q1]** Immutable releases are not turned on.
- **[Q2]** Withdrawing a release deletes the GitHub release and keeps its tag. Its version is never
  used again.
- **[Q3]** The second build's record goes into the release notes, and into the commit that
  records the checksums.
- **[Q6]** After a prod release, `main` is merged back into `dev`.
- **[Q7]** After a prod release, a short proof on a real server.
- **[Q8]** The maintainer is the only person with the admin role.
- **[Q10]** Security reports go through GitHub's private vulnerability reporting.

## In short

A dev release:

1. Once: part 1.
2. The version on `dev` (parts 2 and 3).
3. Tag the commit and push the tag (part 5). Watch the run (part 6).
4. The second build on `dev`, and the commands it prints (part 7). The notes (part 8).

A prod release:

1. Once: part 1.
2. The prod versions on `dev`, merged into `main` (part 4).
3. Tag the commit and push the tag (part 5). Approve the run (part 6).
4. The second build on `main`, and the commands it prints (part 7). The notes (part 8).
5. Merge `main` back into `dev` (part 10).

The first releases are `0.1.0-dev.1`, then `0.1.0`. Both version files on `dev` already name
`0.1.0-dev.1`. Between the two, the dev release is proven on a real server, as
[`specs/005-runner-release/quickstart.md`](../../specs/005-runner-release/quickstart.md), section 7,
describes.

The commands below use two shell variables. Set them in the terminal you release from, with the
version of this release:

```sh
VERSION=0.1.0-dev.1
TAG=runner-v$VERSION
```

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
   release tag. **[Q8]** The maintainer is the only one.

To prove it, from another account that has the Write role and nothing more, **[outward]**
`git push origin runner-v0.0.1-dev.1` must be refused by GitHub. Write down whether this was tried.

### The environment `prod`

A prod release waits in it for the maintainer's approval before anything is built or published.

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
approving it.

### Security reports **[Q10]**

**[outward]** **Settings**, the **Security** section (**Advanced Security**), **Private
vulnerability reporting**, **Enable**. The README's "Reporting a vulnerability" points there.

### Left off: immutable releases **[Q1]**

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
git commit -m "chore(runner): version $VERSION"
```

**[outward]** `git push origin dev`

## 4. Preparing a prod release

Only for a prod release. `main` must never carry a dev version: a zekno built from `main` installs
prod releases only. So the prod versions are committed on `dev` first, then merged into `main`.

```sh
VERSION=0.1.0
TAG=runner-v$VERSION
git switch dev
git pull --ff-only origin dev
```

In `apps/runner/package.json`, set `"version"` to the version. Then write
`apps/cli/src/runner-release.json` with the same version and no checksums:

```sh
cat > apps/cli/src/runner-release.json <<EOF
{
  "version": "$VERSION",
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
git commit -m "chore: prod versions for runner $VERSION"
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
`No development version: apps/runner/package.json holds 0.1.0, apps/cli/src/runner-release.json holds 0.1.0.`
If it names a file instead, stop: fix it on `dev` and merge again.

**[outward]** `git push origin main`

On every push to `main`, the workflow `main-versions` runs the same `check-main`.

From here until part 7 is done, a zekno built from `dev` or `main` holds no checksums, and says it
has no published runner to install. That is expected.

## 5. Starting a release

The one action that starts a release is pushing its tag. First make the tag here, on the right
commit, and run the workflow's own checks against it:

```sh
git switch dev
git pull --ff-only origin dev
git log -1 --format='%H %s'
git tag -a "$TAG" -m "zekno-runner $VERSION"
bun apps/runner/scripts/release.ts check --tag "$TAG"
```

For a prod release, use `main` in place of `dev` in the first two commands.

`check` prints four lines, `environment=`, `version=`, `commit=` and `bun=`, or one sentence that
says what is wrong. When it refuses, the tag was never pushed, so the version is still unused:
remove the tag with `git tag -d "$TAG"`, fix what it said, and make the tag again.

**[outward]** `git push origin "$TAG"`

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
| `release-dev` or `release-prod` | Builds the runner for Linux on x86-64 and ARM64 with that Bun. Checks that both were built, each at most 256 MiB, and that the x86-64 runner answers with the version. Writes the two `.gz` files, `SHA256SUMS` and `RELEASE-NOTES.md`. Stops if a release for the tag exists already. Publishes: a dev release as a pre-release that is never the latest. |

Nothing is published when any step fails. Read why with
`gh run view <run id> --repo zekno-app/zekno --log-failed`. When it failed for a passing reason,
such as the network, run the same run again: **[outward]**
`gh run rerun <run id> --repo zekno-app/zekno --failed`. It builds the same tag and commit, and
publishes nothing twice. When the commit itself is at fault, the version is used: fix the cause
and take the next number (part 3).

**Approving a prod release.** `release-prod` waits for review before its first step. Before you
approve, check that the run names your tag and the commit that `git rev-parse "$TAG^{commit}"`
prints here. Then, on the run's page: **[outward]** **Review deployments**, tick **prod**,
**Approve and deploy**. **Reject** publishes nothing.

When the run has passed:

```sh
gh release view "$TAG" --repo zekno-app/zekno
```

It lists four files: `zekno-runner-linux-x64.gz`, `zekno-runner-linux-arm64.gz`, `SHA256SUMS` and
`RELEASE-NOTES.md`. A dev release is marked as a pre-release.

No zekno installs the release yet. That waits for the second build.

## 7. The second build

The second build is the only way checksums get into zekno. It runs on your own machine, so
GitHub's build service cannot change the runner without the difference being seen.

It needs the Bun version the root `package.json` pins, the network (it downloads the release's
files, npm packages and Bun's runtimes for Linux), and a few minutes. Run it on the branch the
release is recorded on: `dev` for a dev release, `main` for a prod release.

```sh
git switch dev
git pull --ff-only origin dev
git status --short apps/cli/src/runner-release.json
bun --version
bun apps/runner/scripts/second-build.ts "$TAG"
```

For a prod release, use `main` in place of `dev` in the first two commands. `git status` must
print nothing.

It checks the tag, the branch, that `apps/cli/src/runner-release.json` has no change of its own
and records nothing newer, that the tag here and on GitHub is the same commit, that Bun is the
pinned version, and that the commit builds this version. It downloads the release's four files
from the address servers use, over HTTPS only. It builds the tagged commit from `git archive` in a
temporary folder, with `bun install --frozen-lockfile` and the runner's own compile scripts. Then
it compares each binary three ways: its own build, the downloaded file, and the line of
`SHA256SUMS`.

**When all agree**, it writes the checksums into `apps/cli/src/runner-release.json`, prints the
record, `Second build of <tag> (<dev|prod>): matched.` and a table, then:

```text
Recorded runner <version> in apps/cli/src/runner-release.json. Next, on <branch>:
  git add apps/cli/src/runner-release.json
  git commit -F <commit message file>
  git push origin <branch>
  gh release edit <tag> --repo zekno-app/zekno --notes-file <notes file>
```

It runs none of them. Run the first two as printed. The commit message holds the record **[Q3]**.
Add the "Tried on" section to the notes file (part 8). Then **[outward]** run the `git push` and
**[outward]** the `gh release edit` as printed.

From that commit on, a zekno built from the branch installs the release.

**When it stops**, its exit status says why:

| Status | Meaning | What to do |
|--------|---------|------------|
| 1 | Something did not match: a file, the commit, the version, `SHA256SUMS` or the notes. | Below. |
| 2 | A condition on this machine: the wrong branch, a change in `apps/cli/src/runner-release.json`, another Bun, no tag here, or a newer release already recorded. | Do what its sentence says. For a missing tag: `git fetch origin tag "$TAG"`. |
| 3 | It could not finish: the network, or the build. | Run it again. |

Nothing is written to `apps/cli/src/runner-release.json` in any of these.

**When a file differs** (status 1), it names each file that differs with its three checksums,
keeps its build and the downloaded files in a folder it names, and writes the notes with the
record of the mismatch. No zekno installs that release. Then:

1. Stop. Record nothing by hand. Never change the comparison, the build or this rule to make them
   agree.
2. **[outward]** Put the record in the release notes:
   `gh release edit "$TAG" --repo zekno-app/zekno --notes-file <the notes file it names>`.
3. Decide with the maintainer what comes next (`specs/005-runner-release/plan.md`, "If GitHub's
   build differs from the maintainer's"). Keep the folder it named until then.

**What both builds share.** The second build runs on another machine, with its own copy of the
source and its own Bun, so it shows that GitHub's build service changed nothing. Both builds
fetch the same npm packages, pinned by `bun.lock`, and the same Bun runtimes for Linux. A problem
in those would be in both builds, and they would still match. The second build does not check
them.

## 8. The release notes

The workflow writes `RELEASE-NOTES.md` and makes it the release's text: the version, the commit,
the Bun version, "Pre-alpha and unaudited", for a dev release a paragraph saying so, what the
runner is built for, the checksums, and "Second build: Not made yet."

After the second build, two things are added, in the notes file the second build wrote:

- The second build's record, in place of "Not made yet.". The second build puts it there
  **[Q3]**.
- A section "Tried on": what was run where, and what was not. Nothing is listed as tried that was
  not.

```markdown
## Tried on

- <date>: <what was run> on <Linux system>, <x86-64 or ARM64>, <as root or as another user>: <result>.
- Not tried: <what was not, and what stood in for it>.
```

**[outward]** `gh release edit "$TAG" --repo zekno-app/zekno --notes-file <notes file>`

The notes can be edited again at any time, for example once a proof on a real server is done. A
release's files are never replaced.

## 9. Withdrawing a release

When a release turns out to be bad, these steps make every zekno stop installing it **[Q2]**.

1. On each branch that records it, write `apps/cli/src/runner-release.json` with the same version
   and no checksums. A dev release is recorded on `dev`. A prod release is recorded on `main`, and
   on `dev` too once `main` was merged back (part 10). On `dev`, for example:

   ```sh
   VERSION=0.1.0-dev.1
   git switch dev
   git pull --ff-only origin dev
   cat > apps/cli/src/runner-release.json <<EOF
   {
     "version": "$VERSION",
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
   git commit -m "chore(cli): withdraw runner $VERSION"
   ```

   **[outward]** `git push origin dev`, and the same on `main` for a prod release.

   A zekno built from that commit says it has no published runner to install.
2. **[outward]** Delete the GitHub release and keep its tag:
   `gh release delete "runner-v$VERSION" --repo zekno-app/zekno --yes`. Never add `--cleanup-tag`.
   A zekno built before step 1 still holds the checksums. With the files gone, a server it asks
   stops at the download, says it could not download the runner, and installs nothing. A server
   half way through a download stops the same way, with nothing put in place.
3. The version is never used again (part 3). The fix is a new release with the next version,
   recorded as usual.

**Servers that already run it** keep running it: nothing on them changes. Once the next release is
recorded, `zekno server update <name>` replaces it on each, because the next version is newer.
`zekno server update` never puts an older version in place. If a server must not start it again
before then, remove it from the server by hand: `/usr/local/bin/zekno-runner` when zekno logs in
as root, `~/.local/bin/zekno-runner` otherwise. The runner runs only when zekno starts it, so the
apps keep running, and its folder stays as it is. Put a good runner there by hand once there is
one ([README](./README.md), "By hand").

## 10. After a prod release

1. **[Q6]** Merge `main` back into `dev`, so `dev` records the prod release too and the next merge
   into `main` does not conflict on the two version files:

   ```sh
   git switch dev
   git pull --ff-only origin dev
   git merge --no-ff --no-edit main
   ```

   **[outward]** `git push origin dev`
2. **[Q7]** A short proof on a real server: with a zekno built from `main`, on a server that runs
   the dev release of the same version, `zekno status` says the runner is older,
   `zekno server update <name>` brings it to the prod release, and a deploy works. Add what was run
   to the release notes' "Tried on" (part 8).
3. The next dev release sets its version on `dev` (part 3), such as `0.1.1-dev.1`.
