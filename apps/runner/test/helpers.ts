import {
  createDeploy,
  createSecret,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  proposeRoster,
  type Envelope,
  type SecretRecord,
  type Signer,
  type TeamTrust,
} from "@workspace/core"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const RUNNER_MAIN = join(import.meta.dir, "../src/main.ts")
export const COMPOSE = "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n"

export function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `zekno-${label}-`))
}

/**
 * A stand-in for the `docker` command. It records how it was called and with
 * what environment, and exits with the status written in its `exit` file.
 */
export function fakeDocker() {
  const dir = tempDir("docker")
  const path = join(dir, "docker")
  const log = join(dir, "calls.log")
  writeFileSync(
    path,
    `#!/bin/sh\n{ echo "ARGS $*"; env | sed 's/^/ENV /'; echo END; } >> "${log}"\nif [ -f "${dir}/exit" ]; then exit "$(cat "${dir}/exit")"; fi\nexit 0\n`
  )
  chmodSync(path, 0o755)
  return {
    path,
    failWith: (status: number) => writeFileSync(join(dir, "exit"), String(status)),
    calls(): { args: string; env: Record<string, string> }[] {
      if (!existsSync(log)) return []
      return readFileSync(log, "utf8")
        .split("END\n")
        .filter((block) => block.trim())
        .map((block) => {
          const lines = block.trim().split("\n")
          const env: Record<string, string> = {}
          for (const line of lines.filter((entry) => entry.startsWith("ENV "))) {
            const [name, ...rest] = line.slice(4).split("=")
            env[name!] = rest.join("=")
          }
          return { args: lines.find((entry) => entry.startsWith("ARGS "))!.slice(5), env }
        })
    },
  }
}

/** Runs the runner as its own process, the way SSH would. */
export async function runner(home: string, docker: string, command: string, message?: unknown, extra: string[] = []) {
  const child = Bun.spawn([process.execPath, RUNNER_MAIN, command, ...extra], {
    env: { ...process.env, ZEKNO_RUNNER_HOME: home, ZEKNO_DOCKER: docker },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (message !== undefined) child.stdin.write(typeof message === "string" ? message : JSON.stringify(message))
  child.stdin.end()
  const stdout = await new Response(child.stdout).text()
  const code = await child.exited
  let json: Record<string, unknown> | undefined
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Record<string, unknown>
  } catch {
    json = undefined
  }
  return { code, json, stdout }
}

/** A team, a runner that is set up and in the team list, and the pieces to build deploys for it. */
export async function world() {
  const pair = generateMemberKeyPair()
  const signer = createSigner(pair.secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const home = tempDir("runner")
  const docker = fakeDocker()

  const setup = await runner(home, docker.path, "setup", { founding: team.envelope, teamCode: team.confirmationCode })
  const serverId = String(setup.json!.serverId)
  const added = await proposeRoster({
    trust: team.trust,
    servers: [{ name: "prod-1", publicKey: setup.json!.serverPublicKey as never }],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  const synced = await runner(home, docker.path, "sync", { rosters })
  if (synced.json?.outcome !== "ok") throw new Error(`sync failed: ${JSON.stringify(synced.json)}`)

  return { signer, team, trust: added.trust, rosters, home, docker, serverId, setup }
}

export async function buildDeploy(input: {
  trust: TeamTrust
  serverId: string
  signer: Signer
  sequence: number
  values?: Record<string, string>
  app?: string
  compose?: string
  secretVersion?: number
}) {
  const app = input.app ?? "web"
  const secrets: SecretRecord[] = []
  for (const [name, value] of Object.entries(input.values ?? { GREETING: "hello from the test" })) {
    secrets.push(await createSecret({ trust: input.trust, serverId: input.serverId, app, name, value, version: input.secretVersion ?? input.sequence, signer: input.signer }))
  }
  return createDeploy({ trust: input.trust, serverId: input.serverId, app, sequence: input.sequence, compose: input.compose ?? COMPOSE, secrets, signer: input.signer })
}

/** Every file under a folder, with its content, for checking what was written to disk. */
export function filesUnder(dir: string): { path: string; content: string; mode: number }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return [{ path, content: readFileSync(path, "utf8"), mode: statSync(path).mode & 0o777 }]
  })
}

export type { Envelope }
