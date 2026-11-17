/**
 * TT3, the template tests with Docker (specs/012-templates,
 * contracts/contributing.md, "The template tests"; research R12; plan.md,
 * D23; tasks T036): for each file of apps/cli/src/templates/files, its
 * services started from the Compose text zekno would write for them, with
 * secrets made by zekno's own maker, then checked as research R4's probe
 * checked them: running and not restarting 15 s after `up`, no port bound on
 * the machine, each volume a named one, no command line in the containers
 * holding a made value, and a client of test/templates/clients.ts connecting
 * with the connection secret and refused with a wrong password.
 *
 * Run by `bun run test:templates` (`ZEKNO_TEMPLATES_DOCKER=1`) when `docker
 * info` answers, and skipped otherwise, so a plain `bun test` never pulls an
 * image. With Docker, an image not in the local store is pulled by the
 * digest its file names. Each template runs under the Compose project
 * `zekno-test-template-<name>`, publishes no port, and is removed with its
 * volumes in every case (`down -v`, in a `finally`).
 *
 * The made values reach `docker compose` through its environment only
 * (`Bun.spawn`'s `env`), never an argument or a file: the Compose text names
 * each secret as `${NAME}`. They are compared, never printed: a check that
 * fails says which, and anything Docker printed is shown with every made
 * value hidden.
 */
import { afterAll, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { composeText } from "../../src/settings/compose"
import type { ServiceSettings } from "../../src/settings/types"
import { servicesInApp } from "../../src/templates/addition"
import { fillOffer, makePassword } from "../../src/templates/made"
import {
  faultSentence,
  isTemplate,
  readTemplate,
} from "../../src/templates/read"
import type { Template } from "../../src/templates/types"
import { CLIENT_SERVICE, CLIENTS } from "./clients"

const FOLDER = join(import.meta.dir, "../../src/templates/files")

/** How long a template's services run before they are checked (research R12). */
const SETTLE_MS = 15_000
/** How long a client keeps trying to connect, as a database starts. */
const CONNECT_MS = 150_000

/** Whether `docker info` answers; false when Docker is missing or not running. */
function dockerAnswers(): boolean {
  try {
    return (
      Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode === 0
    )
  } catch {
    return false
  }
}

const wanted = process.env.ZEKNO_TEMPLATES_DOCKER === "1"
const available = wanted && dockerAnswers()
if (wanted && !available)
  console.log(
    "Skipping the template tests with Docker: `docker info` does not answer."
  )

/** Every template file of the folder, in the order of the names. */
const FILES = readdirSync(FOLDER)
  .filter((file) => file.endsWith(".json"))
  .sort()

/** A file read; a fault fails the test with the reader's sentence (TT1 says it too). */
function read(file: string): Template {
  const got = readTemplate(file, readFileSync(join(FOLDER, file)))
  if (!isTemplate(got)) throw new Error(faultSentence(file, got))
  return got
}

/** The made values of a run, and the text with each of them hidden: what may be printed. */
function secretsOf(template: Template) {
  const made = new Map(
    template.makes.map((secret) => [secret.name, makePassword(secret.length)])
  )
  const service = template.services[0]![0]
  const env: Record<string, string> = Object.fromEntries([
    ...made,
    ...template.offers.map((offer) => [
      offer.name,
      fillOffer(offer, service, made),
    ]),
  ])
  const values = Object.values(env)
  return {
    env,
    /** Whether `text` holds any made value: compared, never printed. */
    holds: (text: string): boolean =>
      values.some((value) => text.includes(value)),
    /** `text` with every made value hidden. */
    hide: (text: string): string =>
      values.reduce((shown, value) => shown.split(value).join("••••"), text),
  }
}

/** One run of a program, its status and what it printed. `env`: added to this process's environment. */
async function run(argv: readonly string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, ...env },
  })
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code: await child.exited, out: out.trim(), err: err.trim() }
}

/** What `docker inspect` says of a container that these checks read. */
type Inspected = {
  HostConfig: { PortBindings: Record<string, unknown> | null }
  NetworkSettings: { Ports: Record<string, unknown[] | null> | null }
  Mounts: { Type: string; Name?: string; Destination: string }[]
  State: { Running: boolean; Restarting: boolean }
  RestartCount: number
}

// Should a run end before its own `finally`, each project is removed again by its name, with its volumes.
afterAll(async () => {
  if (!available) return
  for (const file of FILES)
    await run([
      "docker",
      "compose",
      "-p",
      `zekno-test-template-${file.slice(0, -".json".length)}`,
      "down",
      "-v",
      "--remove-orphans",
      "--timeout",
      "1",
    ])
}, 120_000)

describe("the template tests with Docker (TT3)", () => {
  for (const file of FILES) {
    const name = file.slice(0, -".json".length)
    const client = CLIENTS[name]

    test.skipIf(!available)(
      `${name} starts with Docker, a client connects`,
      async () => {
        const template = read(file)
        const project = `zekno-test-template-${name}`
        const services = servicesInApp(template, undefined)
        const offers = template.offers.map((offer) => offer.name)
        // The client's service: the template's own image, reading every connection secret.
        const reader: [string, ServiceSettings][] =
          client === undefined || offers.length === 0
            ? []
            : [
                [
                  CLIENT_SERVICE,
                  {
                    image: services[0]![1].image,
                    start: "sleep infinity",
                    secrets: offers,
                  },
                ],
              ]
        const folder = mkdtempSync(join(tmpdir(), "zekno-test-template-"))
        const compose = join(folder, "compose.yaml")
        writeFileSync(
          compose,
          composeText({ version: 1, services: [...services, ...reader] })
        )
        const secrets = secretsOf(template)
        const docker = (...args: string[]) =>
          run(
            ["docker", "compose", "-p", project, "-f", compose, ...args],
            secrets.env
          )
        const started = performance.now()
        try {
          const up = await docker("up", "-d")
          if (up.code !== 0)
            throw new Error(`${name}: not started: ${secrets.hide(up.err)}`)
          await Bun.sleep(SETTLE_MS)

          for (const [service, settings] of services) {
            const id = (await docker("ps", "-q", service)).out
            expect([service, id]).toEqual([
              service,
              expect.stringMatching(/^[0-9a-f]{12,}$/),
            ])
            const inspected = JSON.parse(
              (await run(["docker", "inspect", id, "--format", "{{json .}}"]))
                .out
            ) as Inspected
            // Running, and not restarting, after it had time to fail.
            expect({ service, ...inspected.State }).toMatchObject({
              service,
              Running: true,
              Restarting: false,
            })
            expect([service, inspected.RestartCount]).toEqual([service, 0])
            // No port bound on the machine.
            expect([
              service,
              Object.keys(inspected.HostConfig.PortBindings ?? {}),
            ]).toEqual([service, []])
            for (const bindings of Object.values(
              inspected.NetworkSettings.Ports ?? {}
            ))
              expect([service, bindings ?? []]).toEqual([service, []])
            // Each volume a named one, `<project>_<service>-<volume>`, where the template keeps its data.
            for (const [volume, path] of settings.volumes ?? [])
              expect(
                inspected.Mounts.find((mount) => mount.Destination === path)
              ).toMatchObject({ Type: "volume", Name: `${project}_${volume}` })
          }

          // No command line of any process in the containers holds a made value.
          for (const id of (await docker("ps", "-q")).out.split("\n")) {
            const top = await run(["docker", "top", id])
            expect(top.code).toBe(0)
            expect(secrets.holds(top.out)).toBe(false)
          }

          if (client !== undefined && reader.length > 0) {
            const until = Date.now() + CONNECT_MS
            for (;;) {
              const connected = await docker(
                "exec",
                "-T",
                CLIENT_SERVICE,
                ...client.connect
              )
              if (connected.code === 0 && client.prints.test(connected.out)) {
                expect(secrets.holds(connected.out)).toBe(false)
                break
              }
              if (Date.now() > until)
                throw new Error(
                  `${name}: no client connected: ${secrets.hide(connected.err).slice(-300)}`
                )
              await Bun.sleep(2000)
            }
            for (const wrong of client.wrong)
              expect((await docker("exec", "-T", ...wrong)).code).not.toBe(0)
          }
          console.log(
            `${name} with Docker: running after ${SETTLE_MS / 1000} s, no port bound, data in named volumes, no made value on a command line${client === undefined ? "" : ", a client connected"}; ${Math.round((performance.now() - started) / 100) / 10} s in all`
          )
        } finally {
          await docker("down", "-v", "--remove-orphans", "--timeout", "1")
          rmSync(folder, { recursive: true, force: true })
        }
      },
      240_000
    )

    if (client === undefined)
      test.skip(`${name} a client connects: no client check, the reviewer connects by hand`, () => {})
  }
})
