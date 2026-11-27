/**
 * The `health` and `domains` rows of `zekno settings` and the settings
 * screen (specs/015-domains-https, design/lines.md C5, C6 and E1), marked
 * against this machine's last deploy as every row is. Split from rows.ts,
 * which re-exports them (specs/016-build-from-source, contracts/cli.md
 * CL14).
 */
import { DOMAINS_LABEL, HEALTH_LABEL } from "../domains/words"
import { sanitize } from "../server/sanitize"
import { healthWords, secondsOf } from "./domains-health"
import { deployedOf, markOf, row } from "./row-marks"
import type { ServiceSettings, SettingRow, Settings } from "./types"
import { NOT_SET } from "./words"

/**
 * The `health` row (specs/015-domains-https, design/lines.md C5 and C6):
 * `GET /health, within 60s`, `stays up, within 60s`, or `not set`. It is
 * marked against what the last deploy signed: its path, and the deploy's one
 * limit, which `seconds` is for the file (`healthOf`, the largest of its
 * services'), so a service's own limit marks it only when the limit the next
 * deploy signs changes (research R14, R30).
 */
export function healthRow(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  seconds: number | undefined
): SettingRow {
  const [name, { health }] = service
  return row(
    "Deploy",
    HEALTH_LABEL,
    { service: name, key: "health" },
    health === undefined ? undefined : healthWords(health),
    NOT_SET.health,
    markOf(
      deployed,
      name,
      health === undefined ? undefined : [health.path, seconds],
      (old) =>
        old.health === undefined
          ? { value: undefined }
          : {
              value: [old.health.path, secondsOf(old.health)],
              shown: healthWords(old.health),
            }
    )
  )
}

/**
 * The `domains` rows (design/lines.md, E1): one a domain, in the file's
 * order, labelled on the first only, each marked when the last deploy did
 * not route it; then one for each domain the last deploy routed and the file
 * no longer names, marked removed with it (security review S3's pattern for
 * plain variables). With neither, a `none` row when `none` is asked for (the
 * settings screen), else no row.
 */
export function domainRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  none: boolean
): SettingRow[] {
  const [name, settings] = service
  const now = settings.domains ?? []
  const path = { service: name, key: "domains" } as const
  const rows = now.map((domain, at) =>
    row(
      "Networking",
      at === 0 ? DOMAINS_LABEL : "",
      path,
      domain,
      NOT_SET.domains,
      markOf(deployed, name, domain, (old) => ({
        value: old.domains?.includes(domain) ? domain : undefined,
      }))
    )
  )
  const gone = (deployedOf(deployed, name)?.domains ?? []).filter(
    (domain) => !now.includes(domain)
  )
  rows.push(
    ...gone.map((domain, at): SettingRow => ({
      section: "Networking",
      label: now.length === 0 && at === 0 ? DOMAINS_LABEL : "",
      path,
      shown: NOT_SET.domains,
      set: false,
      removed: { was: sanitize(domain) },
    }))
  )
  // Marked, as every row of a service the last deploy did not have is; else it was `none` then too.
  if (rows.length === 0 && none)
    rows.push(
      row(
        "Networking",
        DOMAINS_LABEL,
        path,
        undefined,
        NOT_SET.domains,
        markOf(deployed, name, 0, () => ({ value: 0 }))
      )
    )
  return rows
}
