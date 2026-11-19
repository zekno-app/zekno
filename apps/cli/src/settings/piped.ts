/**
 * What `zekno settings` prints when its output is piped (specs/010-app-settings,
 * contracts/commands.md, "Piped, TERM=dumb"): one line per setting that is
 * set, the service, the setting's place in the file and its value as the
 * file holds it (`on-failure`, not `on failure`; secrets joined with `,` and
 * no space; `publish` a line of its own). No first line, no sections, no
 * marks: a script reads it. Every value is cleaned with `sanitize`, as every
 * line from the file is, though the reader already refuses every character
 * it would take out (control characters, and since security review S2 the
 * invisible ones), so cleaning changes nothing a file can hold.
 */
import { sanitize } from "../server/sanitize"
import type { ServiceSettings, Settings } from "./types"

/** One piped line: the service, the setting's place, the value. */
export type PipedLine = readonly [service: string, place: string, value: string]

/**
 * A health check's lines (specs/015-domains-https, contracts/cli.md, CL1):
 * its path and its limit as the file writes them, each a line of its own;
 * one with neither, `deploy.healthcheck` and `{}`, as the file holds it.
 */
function healthPlaces(service: ServiceSettings): [string, string][] {
  const { health } = service
  if (health === undefined) return []
  if (health.path === undefined && health.timeout === undefined)
    return [["deploy.healthcheck", "{}"]]
  return [
    ...(health.path === undefined
      ? []
      : [["deploy.healthcheck.path", health.path] as [string, string]]),
    ...(health.timeout === undefined
      ? []
      : [
          ["deploy.healthcheck.timeout", String(health.timeout)] as [
            string,
            string,
          ],
        ]),
  ]
}

/** The places and values of one service that are set, in the order of the file's sections. */
function placesOf(service: ServiceSettings): [string, string][] {
  const places: [string, string | undefined][] = [
    ["source.image", service.image],
    ["deploy.start", service.start],
    ["deploy.restart", service.restart],
    ["deploy.memory", service.memory],
    ["deploy.cpus", service.cpus],
    ...healthPlaces(service),
    [
      "networking.port",
      service.port === undefined ? undefined : String(service.port),
    ],
    [
      "networking.publish",
      service.publish === undefined ? undefined : String(service.publish),
    ],
    // Joined as secrets are, with `,` and no space (CL1).
    ["networking.domains", service.domains?.join(",")],
    ["variables.secrets", service.secrets?.join(",")],
    ...(service.plain ?? []).map(([name, value]): [string, string] => [
      `variables.plain.${name}`,
      value,
    ]),
    ...(service.volumes ?? []).map(([name, path]): [string, string] => [
      `volumes.${name}`,
      path,
    ]),
  ]
  return places.filter(
    (place): place is [string, string] => place[1] !== undefined
  )
}

/** Every line `zekno settings` prints piped for `settings`, services in the file's order. */
export function pipedLines(settings: Settings): PipedLine[] {
  return settings.services.flatMap(([name, service]) =>
    placesOf(service).map(([place, value]): PipedLine => [
      sanitize(name),
      sanitize(place),
      sanitize(value),
    ])
  )
}
