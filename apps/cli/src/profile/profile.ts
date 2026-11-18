/**
 * What the CLI keeps on the developer's machine. Everything here is public
 * or already encrypted and signed: team lists, server addresses, secret
 * records, the deploys that were sent, and the secret statements and versions
 * a server said it holds. The signing key is not here; it is in the keychain.
 *
 * Nothing in these files is trusted as it stands. Team lists, secrets and
 * deploys are signed and are verified again every time they are read; see
 * `openTeam` in context.ts.
 */
import {
  EnvelopeSchema,
  LIMITS,
  SECRET_NAME,
  SecretRecordSchema,
} from "@workspace/core"
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

import { CliError, MISSING_SERVER, UsageError } from "../cli/errors"
import { RUNNER_PATH, SSH_DESTINATION } from "../server/transport"

export const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

/** Deploys kept for each app on each server. Older ones are dropped. */
export const HISTORY_LENGTH = 50

/**
 * The same patterns `server add` checks. They are printed (`server ls`) and
 * put in an `ssh` command, so a value that was changed on disk to hold an
 * escape sequence or an option makes the profile damaged, not something drawn.
 */
const TargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ssh"),
    destination: z.string().regex(SSH_DESTINATION),
    runnerPath: z.string().regex(RUNNER_PATH),
  }),
  z.strictObject({ kind: z.literal("local"), home: z.string().min(1) }),
])

/**
 * The rule the core library holds a member's name to in a team list
 * (`displayName` in packages/core/src/team/roster.ts): no control, format,
 * unassigned or private-use character, which covers escape sequences and
 * bidirectional overrides, no line or paragraph separator, and no space at
 * either end. `\p{C}` also matches a lone surrogate.
 */
const MemberNameSchema = z
  .string()
  .min(1)
  .max(LIMITS.memberNameLength)
  .refine((name) => !/[\p{C}\u2028\u2029]/u.test(name) && name === name.trim())

/** Whether `name` may be a member's name: the rule `--name` is held to, for the name a first deploy asks for. */
export const isMemberName = (name: string): boolean =>
  MemberNameSchema.safeParse(name).success

const ServerSchema = z.strictObject({
  name: z.string().regex(NAME),
  serverId: z.string().regex(/^srv_[0-9a-f]{32}$/),
  target: TargetSchema,
})
export type Server = z.infer<typeof ServerSchema>

const ProfileSchema = z.strictObject({
  memberName: MemberNameSchema,
  /** The name of the keychain entry that holds the signing key and the team code. */
  keyName: z.string().min(1),
  /** Every team list from the founding one, in order. Each is signed, and checked on every run. */
  rosters: z.array(EnvelopeSchema).min(1),
  servers: z.array(ServerSchema),
})
export type Profile = z.infer<typeof ProfileSchema>

const SecretStoreSchema = z.strictObject({
  records: z.array(SecretRecordSchema),
  removals: z.array(EnvelopeSchema),
})
export type SecretStore = z.infer<typeof SecretStoreSchema>

/**
 * One deploy this machine signed and sent. The envelope carries the number,
 * the app, the server and the service definition under the signature, so none
 * of those are stored beside it. `sent` means no answer was recorded.
 */
const HistorySchema = z.array(
  z.strictObject({
    envelope: EnvelopeSchema,
    at: z.string(),
    outcome: z.enum(["sent", "started", "start_failed"]),
  })
)
export type History = z.infer<typeof HistorySchema>

/**
 * What a server said it holds for one app, as the last version-2 deploy of
 * it read on its own connection (specs/014-deploy-v2, data-model.md; research
 * R9): the signed secret statements of its `records` answer, and the app's
 * versions from its `status` answer. It holds what the server said, never a
 * value or a sealed value. It is only a floor: `zekno secret set` and
 * `zekno secret rm` take the next version above it and know a name from it,
 * offline; nothing here is ever signed as a hash or listed in a deploy, which
 * takes only statements verified at deploy time. A statement is held to the
 * core library's `LIMITS.statementPayloadLength`, the length a runner takes.
 */
const HeldSchema = z.strictObject({
  statements: z
    .array(
      EnvelopeSchema.refine(
        (envelope) => envelope.payload.length <= LIMITS.statementPayloadLength
      )
    )
    .max(LIMITS.secretsPerDeploy),
  versions: z
    .array(
      z.strictObject({
        name: z.string().max(LIMITS.secretNameLength).regex(SECRET_NAME),
        version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        removed: z.boolean(),
      })
    )
    .max(LIMITS.secretsPerServer),
})
export type Held = z.infer<typeof HeldSchema>

function read<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  what: string
): z.infer<Schema> | undefined {
  if (!existsSync(path)) return undefined
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new CliError(`${what} at ${path} is not readable.`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new CliError(`${what} at ${path} is damaged.`)
  return parsed.data
}

export function profileStore(home: string) {
  const profilePath = join(home, "profile.json")
  const secretsPath = (serverId: string, app: string) =>
    join(home, "secrets", serverId, `${app}.json`)
  const historyPath = (serverId: string, app: string) =>
    join(home, "history", serverId, `${app}.json`)
  const heldPath = (serverId: string, app: string) =>
    join(home, "held", serverId, `${app}.json`)

  /** Writes a whole file or nothing: a new file under a name nobody can predict, then a rename. */
  function write(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    // The folder may have existed already with wider permissions.
    chmodSync(home, 0o700)
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`
    try {
      // `wx` refuses to write through a file or link that is already there.
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      })
      renameSync(temporary, path)
    } catch {
      rmSync(temporary, { force: true })
      throw new CliError(`Could not write ${path}.`)
    }
  }

  return {
    exists: () => existsSync(profilePath),
    load(): Profile {
      const profile = read(profilePath, ProfileSchema, "The profile")
      if (!profile)
        throw new CliError(
          "No team on this machine yet. Run `zekno init --name <you>` first."
        )
      return profile
    },
    save: (profile: Profile) => write(profilePath, profile),
    secrets: (serverId: string, app: string): SecretStore =>
      read(
        secretsPath(serverId, app),
        SecretStoreSchema,
        "The secret store"
      ) ?? { records: [], removals: [] },
    saveSecrets: (serverId: string, app: string, store: SecretStore) =>
      write(secretsPath(serverId, app), store),
    history: (serverId: string, app: string): History =>
      read(historyPath(serverId, app), HistorySchema, "The deploy history") ??
      [],
    saveHistory: (serverId: string, app: string, history: History) =>
      write(historyPath(serverId, app), history.slice(-HISTORY_LENGTH)),
    /**
     * What the server said it holds for the app. A file that is missing,
     * unreadable or does not match `HeldSchema` is read as empty, never an
     * error: it is only a floor, and the next version-2 deploy writes it again.
     */
    held(serverId: string, app: string): Held {
      try {
        return (
          read(
            heldPath(serverId, app),
            HeldSchema,
            "What the server holds"
          ) ?? {
            statements: [],
            versions: [],
          }
        )
      } catch {
        return { statements: [], versions: [] }
      }
    },
    /** Replaces what the server said it holds for the app, whole. */
    saveHeld: (serverId: string, app: string, held: Held) =>
      write(heldPath(serverId, app), held),
  }
}
export type ProfileStore = ReturnType<typeof profileStore>

/**
 * A server of the profile, by name. `from` is where the name was read when it
 * was not typed, the project file as a sentence shows it, so the sentence
 * for an unknown name says where it came from.
 */
export function findServer(
  profile: Profile,
  name: string | undefined,
  from?: string
): Server {
  if (!name) throw new UsageError(MISSING_SERVER)
  const server = profile.servers.find((entry) => entry.name === name)
  if (!server) {
    const known =
      profile.servers.map((entry) => entry.name).join(", ") || "none yet"
    // A name read from a file is held to the server-name pattern before it gets here.
    if (from !== undefined)
      throw new CliError(
        `${from} names a server "${name}" that is not connected to this machine. Connected servers: ${known}.`
      )
    throw new CliError(
      `No server named "${name}". Connected servers: ${known}.`
    )
  }
  return server
}
