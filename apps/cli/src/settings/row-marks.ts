/**
 * A row of `zekno settings` and the settings screen, and its mark against
 * this machine's last deploy made from settings (specs/010-app-settings,
 * research R4): what rows.ts and route-rows.ts build each row with. Split
 * from rows.ts with no change of behaviour (specs/016-build-from-source,
 * contracts/cli.md CL14), so that neither imports the other.
 */
import { sanitize } from "../server/sanitize"
import type { ServiceSettings, SettingRow, Settings } from "./types"

/** A value as compared: a start command's words, a processor limit's number, a list, or the value itself. */
export type Comparable =
  string | number | readonly (string | number | undefined)[]

/** Whether two values compare equal. */
function same(a: Comparable | undefined, b: Comparable | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, at) => item === b[at])
  return a === b
}

/**
 * One row's mark: none when nothing deployed is known or the value is the
 * deployed one; else changed, with the old value when the deployed settings
 * had this setting of this service.
 */
export function markOf(
  deployed: Settings | undefined,
  service: string,
  now: Comparable | undefined,
  before: (deployed: ServiceSettings) => {
    value: Comparable | undefined
    shown?: string
  }
): Pick<SettingRow, "changed"> {
  if (deployed === undefined) return {}
  const old = deployed.services.find(([name]) => name === service)?.[1]
  if (old === undefined) return { changed: {} }
  const { value, shown } = before(old)
  if (same(now, value)) return {}
  return value === undefined || shown === undefined
    ? { changed: {} }
    : { changed: { was: sanitize(shown) } }
}

export type Section = SettingRow["section"]

/** A row of a setting, set or not. */
export const row = (
  section: Section,
  label: string,
  path: SettingRow["path"],
  shown: string | undefined,
  notSet: string,
  mark: Pick<SettingRow, "changed">
): SettingRow => ({
  section,
  label,
  path,
  shown: sanitize(shown ?? notSet),
  set: shown !== undefined,
  ...mark,
})

/** The settings the last deploy had for `service`, or undefined when not known or it had no such service. */
export const deployedOf = (
  deployed: Settings | undefined,
  service: string
): ServiceSettings | undefined =>
  deployed?.services.find(([name]) => name === service)?.[1]
