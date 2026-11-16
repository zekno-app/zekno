import { afterAll, expect, test } from "bun:test"

import { ready } from "../support/helpers"

/**
 * One run with real Docker and a real container. It only uses an image that
 * is already on this machine, so it never downloads anything, and it removes
 * what it started.
 */
const IMAGE = "caddy:2.11.9"
const app = `e2e-${process.pid}`

async function docker(...args: string[]) {
  const child = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: await child.exited,
    out: (await new Response(child.stdout).text()).trim(),
  }
}

const available = await (async () => {
  try {
    return (
      (await docker("info", "--format", "{{.ServerVersion}}")).code === 0 &&
      (await docker("image", "inspect", IMAGE)).code === 0
    )
  } catch {
    return false
  }
})()
if (!available)
  console.log(
    `Skipping the real-Docker run: Docker is not running or ${IMAGE} is not present.`
  )

afterAll(async () => {
  if (available)
    await docker("compose", "-p", `zekno-${app}`, "down", "--timeout", "1")
})

test.skipIf(!available)(
  "SC-002: a real container starts with the secret in its environment",
  async () => {
    const m = await ready({ realDocker: true })
    m.compose(
      `services:\n  web:\n    image: ${IMAGE}\n    command: ["sh", "-c", "sleep 300"]\n    environment:\n      - GREETING\n`
    )
    m.typing("hello from a real container")
    expect(
      await m.zekno(
        "secret",
        "set",
        "GREETING",
        "--app",
        app,
        "--server",
        "dev"
      )
    ).toBe(0)

    const started = performance.now()
    expect(await m.zekno("deploy", "--app", app, "--server", "dev")).toBe(0)
    console.log(
      `deploy with real Docker: ${Math.round(performance.now() - started)} ms`
    )
    expect(m.lastOut()).toBe(
      `Deploy 1 of ${app} is running on dev with 1 secret.`
    )

    const printed = await docker(
      "compose",
      "-p",
      `zekno-${app}`,
      "exec",
      "-T",
      "web",
      "printenv",
      "GREETING"
    )
    expect(printed.out).toBe("hello from a real container")
  },
  120_000
)
