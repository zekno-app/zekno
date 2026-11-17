/**
 * SC-008 of specs/012-templates (tasks T031): each template of the first set
 * added to an app with `zekno add`, deployed with `zekno deploy` through the
 * local runner and real Docker, and reached by the app's own service with
 * the connection secret it was given. The database publishes no port and
 * keeps its data in the named volume `zekno-<app>_<service>-data`; a wrong
 * password is refused.
 *
 * Skipped unless Docker answers and the four pinned images are in the local
 * image store, as real-docker.test.ts gates its own, so a plain `bun test`
 * never downloads anything. Each app is named `probe-<template>-<pid>`, so
 * its Compose project is `zekno-probe-…`; every container, network and
 * volume of each is removed in `afterAll`. The passwords are made by `zekno
 * add` and stay in the containers: the client reads the connection secret
 * from its own environment and splits it with the shell's parameter
 * expansion, so the password reaches `PGPASSWORD`, an option file, `mongosh`'s
 * `process.env` or `REDISCLI_AUTH`, never an argument (research R4).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { settingsText } from "../../src/settings/text"
import { ready } from "../support/helpers"
import { FIRST_TEMPLATES } from "../support/template-files"

/** One run of `docker <args>`: its status and what it printed. */
async function docker(...args: string[]) {
  const child = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code: await child.exited, out: out.trim(), err: err.trim() }
}

/** How each template's client connects from the app's container, what it prints when it did, and how a wrong password is tried (research R4's probe). */
const CLIENTS: Record<
  string,
  { connect: string[]; prints: RegExp; wrong: string[][] }
> = {
  postgres: {
    connect: [
      "sh",
      "-c",
      'u=${DATABASE_URL#postgres://}; export PGUSER=${u%%:*}; r=${u#*:}; export PGPASSWORD=${r%%@*}; h=${r#*@}; export PGHOST=${h%%:*}; p=${h#*:}; export PGPORT=${p%%/*}; export PGDATABASE=${p#*/}; psql -tAc "select current_user || chr(32) || current_database()"',
    ],
    prints: /^app app$/,
    wrong: [
      [
        "-e",
        "PGPASSWORD=wrong",
        "app",
        "psql",
        "-h",
        "postgres",
        "-U",
        "app",
        "-d",
        "app",
        "-tAc",
        "select 1",
      ],
    ],
  },
  mysql: {
    connect: [
      "sh",
      "-c",
      'u=${DATABASE_URL#mysql://}; user=${u%%:*}; r=${u#*:}; pw=${r%%@*}; h=${r#*@}; host=${h%%:*}; p=${h#*:}; port=${p%%/*}; db=${p#*/}; umask 077; printf "[client]\\npassword=%s\\n" "$pw" > /tmp/c.cnf; mysql --defaults-extra-file=/tmp/c.cnf -h "$host" -P "$port" -u "$user" "$db" -N -e "select current_user(), database()"',
    ],
    prints: /^app@%\s+app$/m,
    wrong: [
      [
        "app",
        "sh",
        "-c",
        'printf "[client]\\npassword=wrong\\n" > /tmp/w.cnf; mysql --defaults-extra-file=/tmp/w.cnf -h mysql -u app app -e "select 1"',
      ],
    ],
  },
  mongodb: {
    connect: [
      "mongosh",
      "--quiet",
      "--nodb",
      "--eval",
      'const d = connect(process.env.MONGODB_URI); const s = d.runCommand({connectionStatus: 1}); print(s.authInfo.authenticatedUsers.map(u => u.user + "@" + u.db).join(",") + " " + d.getName())',
    ],
    prints: /^app@admin app$/,
    wrong: [
      [
        "app",
        "mongosh",
        "--quiet",
        "--nodb",
        "--eval",
        'const d = connect(process.env.MONGODB_URI.replace(/:[^:@]*@/, ":wrong@")); d.runCommand({ping: 1})',
      ],
      [
        "app",
        "mongosh",
        "--quiet",
        "--nodb",
        "--eval",
        'const d = connect("mongodb://mongodb:27017/app"); const r = d.runCommand({listCollections: 1}); if (r.ok !== 1) throw new Error("refused")',
      ],
    ],
  },
  redis: {
    connect: [
      "sh",
      "-c",
      'r=${REDIS_URL#redis://}; u=${r%%@*}; export REDISCLI_AUTH=${u#*:}; h=${r#*@}; redis-cli --no-auth-warning --user "${u%%:*}" -h "${h%%:*}" -p "${h#*:}" ping',
    ],
    prints: /^PONG$/,
    wrong: [
      [
        "-e",
        "REDISCLI_AUTH=wrong",
        "app",
        "sh",
        "-c",
        "redis-cli --no-auth-warning -h redis ping | grep -q '^PONG'",
      ],
      ["app", "sh", "-c", "redis-cli -h redis ping | grep -q '^PONG'"],
    ],
  },
}

const NAMES = ["postgres", "mysql", "mongodb", "redis"] as const
const imageOf = (name: string): string =>
  FIRST_TEMPLATES[name]!.services[0]![1].image

const available = await (async () => {
  try {
    if ((await docker("info", "--format", "{{.ServerVersion}}")).code !== 0)
      return false
    for (const name of NAMES)
      if ((await docker("image", "inspect", imageOf(name))).code !== 0)
        return false
    return true
  } catch {
    return false
  }
})()
if (!available)
  console.log(
    "Skipping the templates with real Docker: Docker is not running or a pinned image is not present."
  )

/** The app each template is added to: its Compose project is `zekno-probe-<template>-<pid>`. */
const appOf = (name: string) => `probe-${name}-${process.pid}`
const projectOf = (name: string) => `zekno-${appOf(name)}`

let m: Awaited<ReturnType<typeof ready>>
beforeAll(async () => {
  if (available) m = await ready({ realDocker: true })
}, 60_000)

afterAll(async () => {
  if (!available) return
  for (const name of NAMES)
    await docker(
      "compose",
      "-p",
      projectOf(name),
      "down",
      "--volumes",
      "--remove-orphans",
      "--timeout",
      "1"
    )
}, 120_000)

/** `docker compose exec -T <args>` in the template's project. */
const exec = (name: string, ...args: string[]) =>
  docker("compose", "-p", projectOf(name), "exec", "-T", ...args)

describe("each template with real Docker (SC-008)", () => {
  for (const name of NAMES)
    test.skipIf(!available)(
      `${name}: added, deployed, reached by the app with its connection secret; no published port; its data in zekno-<app>_${name}-data`,
      async () => {
        const started = performance.now()
        const app = appOf(name)
        const folder = tempDir(`probe-${name}`)
        writeFileSync(
          join(folder, "zekno.app.json"),
          settingsText({
            version: 1,
            services: [
              ["app", { image: imageOf(name), start: "sleep infinity" }],
            ],
          })
        )
        m.deps.cwd = folder
        try {
          expect(
            await m.zekno("add", name, "--yes", "--app", app, "--server", "dev")
          ).toBe(0)
          expect(await m.zekno("deploy", "--app", app, "--server", "dev")).toBe(
            0
          )
        } finally {
          m.deps.cwd = m.project
        }
        const client = CLIENTS[name]!
        const until = Date.now() + 150_000
        for (;;) {
          const run = await exec(name, "app", ...client.connect)
          if (run.code === 0 && client.prints.test(run.out)) break
          if (Date.now() > until)
            throw new Error(
              `${name}: no client connected: ${run.err.slice(-300)}`
            )
          await Bun.sleep(2000)
        }
        const connected = Math.round((performance.now() - started) / 100) / 10
        for (const wrong of client.wrong)
          expect((await exec(name, ...wrong)).code).not.toBe(0)

        const id = (
          await docker("compose", "-p", projectOf(name), "ps", "-q", name)
        ).out
        expect(id).toMatch(/^[0-9a-f]{12,}$/)
        const inspected = JSON.parse(
          (await docker("inspect", id, "--format", "{{json .}}")).out
        ) as {
          HostConfig: { PortBindings: Record<string, unknown> | null }
          NetworkSettings: { Ports: Record<string, unknown[] | null> | null }
          Mounts: { Type: string; Name: string; Destination: string }[]
          State: { Running: boolean; Restarting: boolean }
        }
        expect(inspected.State).toMatchObject({
          Running: true,
          Restarting: false,
        })
        expect(Object.keys(inspected.HostConfig.PortBindings ?? {})).toEqual([])
        for (const bindings of Object.values(
          inspected.NetworkSettings.Ports ?? {}
        ))
          expect(bindings ?? []).toEqual([])
        const volume = `${projectOf(name)}_${name}-data`
        const path = FIRST_TEMPLATES[name]!.services[0]![1].volumes![0]![1]
        expect(
          inspected.Mounts.find((mount) => mount.Destination === path)
        ).toMatchObject({ Type: "volume", Name: volume })
        console.log(
          `${name} with real Docker: added and deployed, a client connected after ${connected} s in all; no published port; data in ${volume} at ${path}; mounts: ${inspected.Mounts.map((mount) => `${mount.Type}:${mount.Destination}`).join(", ")}`
        )
      },
      240_000
    )
})
