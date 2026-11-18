/**
 * The clock a screen is drawn against. Home says how long ago a deploy was
 * and an app's history says the day and the time, both read from this
 * machine's clock (src/shared/time.ts), so they differ on every run. A
 * recipe sets the clock to `NOW` and moves every time the app holds to a
 * fixed one before it draws, and says so under `fixed`.
 */
import { setSystemTime } from "bun:test"

/** The moment every screen is drawn at, in UTC (capture.ts runs each recipe with TZ=UTC). */
export const NOW = new Date("2026-11-18T10:30:00.000Z")

/** A moment `minutes` before `NOW`, as the app keeps times. */
export const before = (minutes: number): string =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString()

const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/

/**
 * A copy of `value` with every time in it moved: the latest to `latest`
 * minutes before `NOW`, and each earlier one `apart` minutes before the one
 * after it, so their order stays. The clock is set to `NOW`.
 */
export function atFixedTimes<T>(value: T, latest: number, apart: number): T {
  const times = new Set<string>()
  const collect = (item: unknown) => {
    if (typeof item === "string" && TIME.test(item)) times.add(item)
    else if (Array.isArray(item)) item.forEach(collect)
    else if (item && typeof item === "object")
      Object.values(item).forEach(collect)
  }
  collect(value)
  const order = [...times].sort().reverse()
  const moved = new Map(
    order.map((time, index) => [time, before(latest + index * apart)])
  )
  setSystemTime(NOW)
  return JSON.parse(JSON.stringify(value), (_key, item: unknown) =>
    typeof item === "string" && moved.has(item) ? moved.get(item) : item
  ) as T
}
