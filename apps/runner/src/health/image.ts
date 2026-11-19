/**
 * The pinned image, for a health check with a path (specs/015-domains-https,
 * contracts/runner.md, RN11; security review S3). Each such check is a
 * short-lived container of the image the proxy runs, and a server with
 * health-checked apps and no proxy may not have it. It is made sure of once,
 * before the wait begins: looked for, and pulled by its digest only when it
 * is missing, on a time limit of its own, so that no check has to pull it
 * and the time each check is given stays within the wait's limit.
 */
import { runDocker } from "../docker/run"
import { PROXY_IMAGE } from "../proxy/image"

/** How long a pull of the pinned image may take. Not counted against the health check's limit. */
const PULL_MS = 5 * 60_000

/** Whether the pinned image is on this machine, pulled now if it was not. */
export async function pinnedImageHere(dir: string): Promise<boolean> {
  const found = await runDocker(dir, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    PROXY_IMAGE,
  ])
  if (found.code === 0) return true
  const pulled = await runDocker(dir, ["pull", PROXY_IMAGE], {
    timeoutMs: PULL_MS,
  })
  return pulled.code === 0
}
