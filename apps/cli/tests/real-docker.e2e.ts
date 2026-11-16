/**
 * One deploy with real Docker and a real container. It runs only when asked
 * (`bun run test:e2e:docker`, which sets ZEKNO_E2E_REAL_DOCKER=1), uses an
 * image already on this machine so it downloads nothing, and removes the
 * container and its network afterwards whatever happens. Exact steps, no
 * model: what it checks is Docker's, not a judgement.
 */
import { createWorld, type RealDocker } from "./support/world"
import { expect, terminalTest as base } from "./support/fixtures"

/** The image the existing real-Docker test uses (test/scenarios/real-docker.test.ts). */
const IMAGE = "caddy:2.11.9"
const APP = `e2e-${process.pid}`
/** Only this machine's Docker programs and sockets: a small environment, never the run's. */
const DOCKER_ENV = {
  PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
  HOME: process.env.HOME ?? "",
}

async function docker(
  binary: string,
  ...args: string[]
): Promise<{ code: number; out: string }> {
  const child = Bun.spawn([binary, ...args], {
    env: DOCKER_ENV,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: await child.exited,
    out: (await new Response(child.stdout).text()).trim(),
  }
}

/** Docker on this machine, when it is running and has the image; otherwise why not. */
async function findDocker(): Promise<RealDocker | string> {
  const binary = Bun.which("docker", { PATH: DOCKER_ENV.PATH })
  if (!binary) return "Docker is not installed"
  if (
    (await docker(binary, "info", "--format", "{{.ServerVersion}}")).code !== 0
  )
    return "Docker is not running"
  if ((await docker(binary, "image", "inspect", IMAGE)).code !== 0)
    return `${IMAGE} is not on this machine`
  const host = (
    await docker(
      binary,
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}"
    )
  ).out
  const plugins = (
    await docker(
      binary,
      "info",
      "--format",
      '{{range .ClientInfo.Plugins}}{{.Name}} {{.Path}}{{"\\n"}}{{end}}'
    )
  ).out
  const composePlugin = plugins
    .split("\n")
    .find((line) => line.startsWith("compose "))
    ?.slice("compose ".length)
  if (!host || !composePlugin)
    return "Docker's address or its Compose plugin could not be found"
  return { binary, host, composePlugin }
}

base(
  "real Docker: deploy one container, see it running, and clean up",
  { tags: ["docker"], timeout: 180_000 },
  async ({ terminal, screen }) => {
    base.skip(
      process.env.ZEKNO_E2E_REAL_DOCKER !== "1",
      "real Docker runs only with bun run test:e2e:docker"
    )
    const found = await findDocker()
    base.skip(typeof found === "string", `skipped: ${found as string}`)
    const realDocker = found as RealDocker
    const world = await createWorld({ realDocker })
    try {
      await world.init("ada")
      await world.addThisMachine("prod")
      world.compose(
        `services:\n  web:\n    image: ${IMAGE}\n    command: ["sh", "-c", "sleep 300"]\n`
      )
      await world.link(APP, "prod")
      await terminal.open(world.launch())
      // The pane wraps this line where the app's name ends it; the start is always whole.
      await expect(
        screen.getByText(new RegExp(`This folder is linked to ${APP}\\b`))
      ).toBeVisible()

      await terminal.press("d")
      await expect(screen.getByText(/✔ Started/)).toBeVisible({
        timeout: 60_000,
      })
      await terminal.press("Escape")
      // Home reads what runs every few seconds: the container shows as running (its name is cut to fit the column).
      await expect(
        screen.getByRole("option", {
          selected: true,
          name: /^e2e-\S*\s+1\s+● running/,
        })
      ).toBeVisible({ timeout: 20_000 })

      const running = await docker(
        realDocker.binary,
        "ps",
        "--filter",
        `label=com.docker.compose.project=zekno-${APP}`,
        "--format",
        "{{.Names}} {{.State}}"
      )
      expect(running.out).toBe(`zekno-${APP}-web-1 running`)
    } finally {
      await terminal.close()
      await docker(
        realDocker.binary,
        "compose",
        "-p",
        `zekno-${APP}`,
        "down",
        "--remove-orphans",
        "--timeout",
        "1"
      )
      world.cleanup()
    }
    // Nothing is left behind: no container and no network of the project.
    expect(
      (
        await docker(
          realDocker.binary,
          "ps",
          "-a",
          "--filter",
          `label=com.docker.compose.project=zekno-${APP}`,
          "-q"
        )
      ).out
    ).toBe("")
    expect(
      (
        await docker(
          realDocker.binary,
          "network",
          "ls",
          "--filter",
          `label=com.docker.compose.project=zekno-${APP}`,
          "-q"
        )
      ).out
    ).toBe("")
  }
)
