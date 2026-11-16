/**
 * What `zekno settings` prints when its output is piped (specs/010-app-settings,
 * contracts/commands.md, "Piped, TERM=dumb"): one line per setting that is
 * set, the service, the setting's place in the file and its value as the
 * file holds it (`on-failure`, not `on failure`; secrets joined with `,` and
 * no space; `publish` a line of its own). No first line, no sections, no
 * marks: a script reads it. Every value is cleaned with `sanitize`, as every
 * line from the file is; the reader holds a value to no control character
 * already, so only invisible characters could ever be taken out.
 */
import { sanitize } from "../server/sanitize"
import type { ServiceSettings, Settings } from "./types"

/** One piped line: the service, the setting's place, the value. */
export type PipedLine = readonly [service: string, place: string, value: string]

/** The places and values of one service that are set, in the order of the file's sections. */
function placesOf(service: ServiceSettings): [string, string][] {
  const places: [string, string | undefined][] = [
    ["source.image", service.image],
    ["deploy.start", service.start],
    ["deploy.restart", service.restart],
    ["deploy.memory", service.memory],
    ["deploy.cpus", service.cpus],
    [
      "networking.port",
      service.port === undefined ? undefined : String(service.port),
    ],
    [
      "networking.publish",
      service.publish === undefined ? undefined : String(service.publish),
    ],
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
