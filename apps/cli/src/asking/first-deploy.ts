/**
 * `zekno deploy` at a terminal (specs/006-cli-small-features,
 * contracts/first-deploy.md, mock-up 3): from nothing, with something
 * missing, and with nothing missing. It finds what is missing and makes it in
 * order, each thing whole before the next question: the key, the server, the
 * app and whether to remember the folder, the values the Compose file expects
 * that have no secret, then the deploy. A second run carries on from what
 * exists, since each step that is done already is skipped.
 *
 * Nothing here signs, writes, installs or sends anything itself: each step is
 * an operation that exists already (`createTeam`, `prepareServerAdd` and
 * `addServer`, `linkFolder`, `prepareSecretSet` and `setSecret`,
 * `prepareDeploy` and `send`), with the checks it always makes, so nothing
 * about what is signed, checked or sent is new. This module only orders them
 * and asks between them. It is reached only when the interface `asks`
 * (research R1); with no terminal `zekno deploy` is exactly as before.
 *
 * The rules of the signed link are kept: with a profile, zekno.json is judged
 * by `withProject` as for every command, so the first-use question comes
 * before any other question and any connection, and a file not signed by the
 * team is named and never used (research R6). With no profile no file can be
 * signed by the team, so one is named and never used either.
 *
 * Like the rest of what `cli.ts` loads, this module loads neither Ink nor
 * React (main.ts loads the interface only once DEV is out of the environment).
 */
import { acceptedLinks } from "../project/accepted"
import { flagsAgain, fromRow, send, shownFile } from "../commands/deploy"
import { SSH_IDENTITY } from "../commands/server"
import { expectedValues } from "../project/compose-file"
import {
  openTeam,
  remoteThroughUi,
  reopenTeam,
  type Deps,
  type Team,
  type teamOnce,
} from "../cli/context"
import {
  CliError,
  Left,
  MISSING_SERVER,
  NOTHING_DONE,
  UsageError,
} from "../cli/errors"
import type { InstallEvent } from "../server/install/lines"
import { AppTaken, checkApp, prepareDeploy, type Where } from "../ops/deploy"
import { createTeam } from "../ops/init"
import {
  linkFolder,
  unlinkWritten,
  writtenLink,
  type WrittenLink,
} from "../ops/link"
import { listSecrets, prepareSecretSet, setSecret } from "../ops/secret"
import {
  addServer,
  foundDetail,
  prepareServerAdd,
  runnerWarning,
} from "../ops/server"
import {
  findServer,
  isMemberName,
  NAME,
  profileStore,
  type Server,
} from "../profile/profile"
import { findProject } from "../project/file"
import { withProject, type Details, type FromProject } from "../project/project"
import { notSignedHere } from "../project/signed"
import { RUNNER_RELEASE } from "../version/runner-release"
import { sanitize } from "../server/sanitize"
import { SETTINGS_FILE } from "../settings/file"
import { chooseSource, readSource } from "../settings/source"
import { SSH_DESTINATION } from "../server/transport"
import { megabytes } from "../shared/sizes"
import type { ListQuestion, Ui } from "../ui/types"
import { whichApp, whichFile, whichServer, type How } from "./asking"

/** F2: what the team code is for (mock-up 3, the app's words). */
export const TEAM_CODE_ABOUT =
  "Identifies your team. A server checks it before it agrees to obey your team."

/** F3: what the server code is for (mock-up 3, the app's words). */
export const SERVER_CODE_ABOUT =
  "Identifies this server's key. Teammates compare it before they trust the server."

/** Said once the key is in the keychain (mock-up 3). */
export const KEY_CREATED = "Key created. It is in your system keychain."

/** F5: whether to remember the folder (mock-up 3). */
export const rememberFolder = (app: string, server: string): string =>
  `Remember this folder? It writes zekno.json, so it always deploys ${app} to ${server}.`

/** F6: how many values the Compose file expects that have no secret (mock-up 3). `file` as the deploy panel names it. */
export const expectsValues = (file: string, count: number): string =>
  `${file} expects ${count} ${count === 1 ? "value" : "values"} that ${count === 1 ? "has" : "have"} no secret yet.`

/** F8: leaving a question once something was made in this run (research Q3). */
export const NOTHING_MORE =
  "Nothing more was done. What was set up so far is kept: run `zekno deploy` again to carry on."

/** F9: after a failure's own sentence, once something was made in this run (research Q3). */
export const KEPT_SO_FAR =
  "What was set up so far is kept: run `zekno deploy` again to carry on."

/** A6: why a name for the team list is refused. Needs approval (research Q4). */
export const MEMBER_NAME_RULE =
  "A name is 1 to 64 characters, with no control character and no space at either end."

/** A7: why an SSH destination is refused, as `prepareServerAdd` says it. */
export const DESTINATION_RULE =
  "That SSH destination is not valid. Use the form user@host."

/** A8: why a server's name is refused, as `prepareServerAdd` says it. */
export const SERVER_NAME_RULE =
  "Give the server a name of lowercase letters, digits and hyphens."
export const serverTaken = (name: string): string =>
  `A server named "${name}" is already connected.`

/** What `zekno deploy` was typed with, `--skip-dns-check` too (specs/015-domains-https, CL3). */
export type DeployFlags = Where & { file?: string; skipDnsCheck?: boolean }

/**
 * F1: the opening line, only when the key or a server is missing. It counts
 * what is missing, in the order it is made: `your key` (no profile), `a
 * server` (none for this deploy), `this app` (no `--app` and no zekno.json
 * app). Needs approval as a rule (research Q4); its first two forms are the
 * mock-up's.
 */
export function openingLine(missing: {
  key: boolean
  server: boolean
  app: boolean
}): string | undefined {
  if (!missing.key && !missing.server) return undefined
  const things = [
    missing.key ? "your key" : "",
    missing.server ? "a server" : "",
    missing.app ? "this app" : "",
  ].filter(Boolean)
  const count = `${["One", "Two", "Three"][things.length - 1]} ${things.length === 1 ? "thing" : "things"} first: ${things.join(", ")}.`
  return missing.key ? `Nothing is set up on this machine yet. ${count}` : count
}

/**
 * The interface, with an empty line before each block of mock-up 3 after the
 * first (`Ui.gap`). `next()` says a new block starts; its empty line is drawn
 * only once something of the block is drawn, so a step that draws nothing
 * (every detail given) leaves no empty line behind. The deploy panel, the
 * last block, has an empty line above it of its own.
 */
function inBlocks(ui: Ui): { ui: Ui; next(): void } {
  let started = false
  let pending = false
  const before = () => {
    if (pending && started) ui.gap()
    pending = false
    started = true
  }
  // The deploy panel brings its own empty line above it (board "zekno deploy: success and failure"), so none is added.
  const deploy: Ui["deploy"] = (start) => {
    pending = false
    started = true
    return ui.deploy(start)
  }
  const drawing =
    <A extends unknown[], R>(draw: (...args: A) => R) =>
    (...args: A): R => {
      before()
      return draw(...args)
    }
  return {
    ui: {
      ...ui,
      info: drawing(ui.info),
      success: drawing(ui.success),
      warn: drawing(ui.warn),
      note: drawing(ui.note),
      field: drawing(ui.field),
      table: drawing(ui.table),
      line: drawing(ui.line),
      code: drawing(ui.code),
      groups: drawing(ui.groups),
      deploy,
      remote: drawing(ui.remote),
      confirm: drawing(ui.confirm),
      askSecret: drawing(ui.askSecret),
      askValue: drawing(ui.askValue),
      ask: drawing(ui.ask),
      choose: <T>(question: ListQuestion<T>) => (before(), ui.choose(question)),
    },
    next() {
      pending = true
    },
  }
}

/** Whether a zekno.json applies to `cwd` (here or in a folder above), used or not. One that cannot be read is there all the same. */
function projectFileFound(cwd: string): boolean {
  try {
    return findProject(cwd) !== undefined
  } catch {
    return true
  }
}

/** Whether the profile now names a server `name`: an `addServer` that failed after it wrote the profile has made it. */
function inProfile(home: string, name: string): boolean {
  try {
    return profileStore(home)
      .load()
      .servers.some((server) => server.name === name)
  } catch {
    return false
  }
}

/**
 * Every `zekno deploy` at a terminal, step by step as contracts/first-deploy.md,
 * "The steps", says. Returns the exit status of the deploy (`send`): 0, or 1
 * when the app did not start. Leaving a question once something was made in
 * this run says F8; another failure then ends with its own sentence and F9.
 */
export async function deployAtTerminal(
  deps: Deps,
  team: ReturnType<typeof teamOnce>,
  flags: DeployFlags
): Promise<number> {
  const view = inBlocks(deps.ui)
  const shown: Deps = { ...deps, ui: view.ui }
  const { ui } = shown
  // The verified team for the whole run, opened once (research R7). Every operation is handed it, so the keychain is read
  // once; once a step changed the profile (a server added), it is read again from the profile folder and proved again.
  let current: Team | undefined
  const ops = (): Deps => ({ ...shown, team: async () => current! })

  // 1. Before anything is asked (FR-014): zekno.json judged, the first-use question first; the file deployed (a Compose
  // file, or a settings file) chosen and read once.
  const hasProfile = profileStore(deps.home).exists()
  let details: DeployFlags & FromProject = { ...flags }
  if (hasProfile) {
    details = await withProject<Details>(
      deps.cwd,
      flags,
      ["app", "server", "file"],
      {
        profile: deps.home,
        trust: team.trust,
        confirm: (question, refusal) => ui.confirm(question, refusal),
        leaveAside: (sentence) => ui.warn(sentence),
      }
    )
  } else if (flags.app === undefined || flags.server === undefined) {
    // No team, so no zekno.json can be signed by it: named, and never used. Given both names it is left aside without a word, as with a team.
    const found = findProject(deps.cwd)
    if (found) ui.warn(notSignedHere(found, deps.cwd))
  }
  if (flags.app !== undefined) checkApp(flags.app)
  const fileHere = projectFileFound(deps.cwd)
  // Which file (specs/010-app-settings, contracts/deploy.md): -f, the link, the one here; with both here and nothing
  // above, DP1, before any other question but the first-use one. The file chosen is read as the one here would be,
  // inside this folder (never through a link out of it), and is the file "Remember this folder?" names.
  let source = chooseSource(deps.cwd, {
    file: flags.file,
    project: details.project,
  })
  let named: string | undefined
  if (source.kind === "both") {
    named = await whichFile(shown)
    const here = { kind: "default", folder: deps.cwd } as const
    source =
      named === SETTINGS_FILE
        ? { kind: "settings", source: here }
        : { kind: "compose", source: here }
  }
  // Read once: a fault of a settings file is said here, before any question but those two.
  const read = readSource(source, deps.cwd)
  if (source.kind === "settings" && source.source.kind === "default")
    named = SETTINGS_FILE
  if (read.text.trim() === "")
    throw new CliError(`The Compose file at ${sanitize(read.path)} is empty.`)
  if (hasProfile) current = await team.take()

  // 2. The opening line, only when the key or a server is missing.
  const noServer = current === undefined || current.profile.servers.length === 0
  if (noServer && flags.server !== undefined && !NAME.test(flags.server))
    throw new UsageError(SERVER_NAME_RULE)
  const opening = openingLine({
    key: !hasProfile,
    server: noServer,
    app: details.app === undefined,
  })
  if (opening !== undefined) ui.note(opening)

  let made = false
  // What this run made other than zekno.json (the key, a server, a value), and the zekno.json it wrote, if any (security review S3).
  let kept = false
  let wrote: WrittenLink | undefined
  let server: Server
  let app: string
  let fresh: boolean
  try {
    // 3. The key.
    if (current === undefined) {
      view.next()
      const name = await ui.ask({
        question: "Your name",
        check: (answer) =>
          isMemberName(answer) ? undefined : MEMBER_NAME_RULE,
        missing: new CliError(
          "No team on this machine yet. Run `zekno init --name <you>` first."
        ),
      })
      const created = await createTeam(deps, name)
      made = true
      kept = true
      ui.success(KEY_CREATED)
      ui.code("Team code", created.teamCode, TEAM_CODE_ABOUT)
      current = await openTeam(deps)
    }

    // 4. The server: added when there is none, else the one given, linked, the only one, or asked.
    let serverHow: How
    if (current.profile.servers.length === 0) {
      view.next()
      const connected = current.profile.servers
      const destination = await ui.ask({
        question: "Where is the server?",
        check: (answer) =>
          SSH_DESTINATION.test(answer) ? undefined : DESTINATION_RULE,
        missing: new UsageError(MISSING_SERVER),
      })
      const name =
        flags.server ??
        (await ui.ask({
          question: "A name for it",
          check: (answer) =>
            !NAME.test(answer)
              ? SERVER_NAME_RULE
              : connected.some((entry) => entry.name === answer)
                ? serverTaken(answer)
                : undefined,
          missing: new UsageError(MISSING_SERVER),
        }))
      await connectServer(ops(), name, destination, () => (made = kept = true))
      // The profile now holds the next team list and the server: read again and proved again, without the keychain.
      current = reopenTeam(current)
      server = findServer(current.profile, name)
      serverHow = "made"
      view.next()
    } else {
      view.next()
      const which = await whichServer(shown, current, {
        server: details.server,
        serverFrom: details.serverFrom,
      })
      server = which.server
      serverHow = which.how
    }

    // 5. The app, and 6. whether to remember the folder.
    const chosen = await whichApp(
      shown,
      current,
      server,
      {
        app: details.app,
        linked: details.app !== undefined && flags.app === undefined,
      },
      { offerNew: true, folder: deps.cwd }
    )
    app = chosen.app
    fresh = chosen.fresh
    if (
      (serverHow === "asked" ||
        serverHow === "made" ||
        chosen.how === "asked") &&
      !fileHere &&
      flags.file === undefined
    ) {
      if (
        await ui.confirm(rememberFolder(app, server.name), NOTHING_DONE, {
          leave: true,
        })
      ) {
        const before = acceptedLinks(deps.home)
        // It names the file this deploy uses: zekno.app.json, or the one chosen at DP1.
        const linked = await linkFolder(
          ops(),
          {
            app,
            server: server.name,
            ...(named === undefined ? {} : { file: named }),
          },
          (question, refusal) => ui.confirm(question, refusal)
        )
        wrote = writtenLink(deps.home, deps.cwd, linked, before)
        made = true
      }
    }

    // 7. The values the Compose file expects that the app has no secret for (research Q2): each asked hidden, Esc skips it.
    const expected = expectedValues(read.text)
    if (expected.length > 0) {
      const set = new Set(
        (await listSecrets(ops(), { app, server: server.name })).secrets.map(
          (secret) => secret.name
        )
      )
      const missing = expected.filter((name) => !set.has(name))
      if (missing.length > 0) {
        view.next()
        ui.warn(expectsValues(shownFile(deps.cwd, read.path), missing.length))
        for (const name of missing) {
          const plan = await prepareSecretSet(ops(), name, {
            app,
            server: server.name,
          })
          // The value goes to the secret operation and nowhere else: not into a line, an error or a file but its sealed record.
          const value = await ui.askValue(
            `Value for ${plan.name} (${plan.app} on ${plan.server.name}): `,
            plan.name
          )
          if (value === undefined) continue
          await setSecret(plan, value)
          made = kept = true
        }
      }
    }
  } catch (error) {
    throw keptSoFar(error, made)
  }

  // 8. The deploy, with the text read in step 1. It ends as any `zekno deploy` does. A name typed as new is compared
  // with what the runner holds, on the deploy's own connection, before anything is signed (security review S3): when
  // the runner holds it, the deploy stops with A12. A zekno.json this run wrote names that app, and the next run would
  // deploy onto it without asking: it is taken back, with its record of first use. The key, a server and the values
  // made in this run are kept, and F9 says so; when zekno.json could not be taken back (it changed since), A12 is said
  // alone, since running again would deploy the app it names.
  const plan = await prepareDeploy(ops(), { app, server: server.name, read })
  const typed = { app: flags.app, server: flags.server }
  try {
    return await send(
      ops(),
      { ...plan, fresh, skipDnsCheck: flags.skipDnsCheck === true },
      { typed },
      {
        app: plan.app,
        server: plan.server.name,
        file: shownFile(deps.cwd, plan.from),
        flags: flagsAgain(typed),
        ...fromRow(deps.cwd, plan),
      }
    )
  } catch (error) {
    if (!(error instanceof AppTaken)) throw error
    const undone = wrote === undefined || unlinkWritten(deps.home, wrote)
    throw keptSoFar(error, undone && kept)
  }
}

/**
 * Adds the server as `zekno server add --ssh` does (FR-012): the same plan,
 * the same installer and checks, inside a quiet step so SSH can ask for a
 * password or a host key on the terminal. The installer's steps are drawn as
 * they arrive, then the server code, where the server's identity rests, and a
 * runner of another version, as `server add` says them. `madeIt` is called
 * once the profile names the server, also when what follows then fails.
 */
async function connectServer(
  deps: Deps,
  name: string,
  destination: string,
  madeIt: () => void
): Promise<void> {
  const { ui } = deps
  const plan = await prepareServerAdd(deps, name, { ssh: destination })
  const carried = (deps.release ?? RUNNER_RELEASE).version
  let bytes: number | undefined
  const installed = (event: InstallEvent) => {
    if (event.kind === "connected") ui.success("Connected over SSH")
    else if (event.kind === "docker") ui.success("Docker with Compose found")
    else if (event.kind === "runner")
      ui.success("Runner found", foundDetail(event.version, carried))
    else if (event.kind === "download") bytes = event.bytes
    else if (event.kind === "install")
      ui.success(
        "Runner installed",
        `${bytes === undefined ? "" : `${megabytes(bytes)}, `}checksum verified`
      )
  }
  let result
  try {
    result = await ui.step(
      `Connecting ${plan.name}`,
      () =>
        addServer(remoteThroughUi(deps), plan, {
          install: installed,
          stage: (stage) => {
            if (stage === "added")
              ui.success(`Added ${plan.name} to the signed team list`)
          },
          resumed: () =>
            ui.info(
              "The runner was already set up for your team by an earlier attempt. Carrying on from there."
            ),
          detail: (line) => ui.remote(line),
        }),
      { quiet: true }
    )
  } catch (error) {
    // Setup done and the team list written, then the runner did not take it (`sync`): the server is in the profile, as `server add` leaves it.
    if (inProfile(deps.home, plan.name)) madeIt()
    throw error
  }
  madeIt()
  ui.code("Server code", result.code, SERVER_CODE_ABOUT)
  ui.note(SSH_IDENTITY)
  // A runner of another version than this zekno's is said once, as `server add` says it.
  const warning =
    result.relation &&
    runnerWarning(result.name, result.runner?.version, result.relation, carried)
  if (warning) ui.warn(warning)
}

/**
 * What a failure says once something was made in this run (research Q3):
 * leaving a question, F8; any other failure a person can act on, its own
 * sentence followed by F9. Before anything was made, it says what it says.
 */
function keptSoFar(error: unknown, made: boolean): unknown {
  if (!made) return error
  if (error instanceof Left) return new CliError(NOTHING_MORE)
  if (error instanceof CliError)
    return new CliError(`${error.message} ${KEPT_SO_FAR}`)
  return error
}
