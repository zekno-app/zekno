import { expect, test } from "./support/fixtures"

const COMPOSE =
  "services:\n  web:\n    image: example/web:1\n  worker:\n    image: example/worker:1\n"

/** What the stand-in Docker prints for `docker compose logs`: two services, as Docker writes them. */
const LINES = [
  "web-1     | 2026-11-14T09:00:01.000000001Z listening on 8080",
  "worker-1  | 2026-11-14T09:00:02.000000001Z picked job 1",
  "web-1     | 2026-11-14T09:00:03.000000001Z GET /jobs 200",
  "worker-1  | 2026-11-14T09:00:04.000000001Z finished job 1",
].join("\n")

test("logs: open them, filter for a word, show one service, pause", async ({
  world,
  terminal,
  agent,
  screen,
}) => {
  await world.init("ada")
  await world.addThisMachine("prod")
  world.compose(COMPOSE)
  await world.link("demo", "prod")
  await world.deploy()
  // Docker keeps following, as it does, until the app lets go of the logs.
  world.docker.logs("demo", `${LINES}\n`, { follow: true })
  await terminal.open(world.launch())
  await expect(
    screen.getByText(/This folder is linked to demo on prod/)
  ).toBeVisible()
  const banner = screen.getByRole("banner")

  await agent.act("open the logs")
  await expect(banner).toContainText("prod › demo › logs")
  await expect(screen.getByText(/listening on 8080/)).toBeVisible({
    timeout: 10_000,
  })
  await expect(screen.getByText(/finished job 1/)).toBeVisible()

  await agent.act("filter the logs for {word}", { params: { word: "job" } })
  await expect(screen.getByText("filter › job")).toBeVisible()
  await expect(screen.getByText(/listening on 8080/)).toBeHidden()
  await expect(screen.getByText(/job/)).toHaveCount(4)

  await agent.act("show only the {service} service", {
    params: { service: "worker" },
  })
  await expect(banner).toContainText("worker")
  await expect(screen.getByText(/GET \/jobs 200/)).toBeHidden()
  await expect(screen.getByText(/picked job 1/)).toBeVisible()

  await agent.act("pause following")
  await expect(banner).toContainText("● paused")
  await expect(screen.getByRole("toolbar", { name: "keys" })).toContainText(
    "f resume following"
  )
})
