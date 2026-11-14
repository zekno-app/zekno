/**
 * When something happened, as the screens say it: "2 min ago" on Home, and
 * "today 21:52" in an app's deploy history. Pure functions of the time and
 * "now", in this machine's time zone, so they can be tested.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** The moment `at` names, or undefined when it is not a time. */
function parse(at: string): Date | undefined {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Whole calendar days from `then` to `now`, in local time. Rounded, so a day of 23 or 25 hours still counts as one. */
function calendarDays(then: Date, now: Date): number {
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((start(now) - start(then)) / DAY)
}

const two = (value: number) => String(value).padStart(2, "0")
const clock = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`

/** "3 Oct", or "3 Oct 2025" in another year. The month is spelled, so the order of day and month cannot be misread. */
function day(date: Date, now: Date): string {
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"} ago`

/** A time as Docker writes it in a log line: RFC 3339, with up to nine digits of fractions (LogEvent's pattern). */
const LOG_TIME = /^(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2}))(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

/**
 * The time of a log line as the logs screen shows it: `21:52:03`, in this
 * machine's time zone. A time this machine cannot place in its own zone is
 * shown as Docker wrote it, by its hours, minutes and seconds; anything else
 * as `--:--:--`, the same width, so the columns stay in place.
 */
export function logClock(time: string): string {
  const parts = LOG_TIME.exec(time)
  if (!parts) return "--:--:--"
  // Milliseconds at most: a date with nine digits of fractions is not one every parser reads.
  const date = new Date(`${parts[1]}${(parts[3] ?? "").slice(0, 4)}${parts[4]}`)
  if (Number.isNaN(date.getTime())) return parts[2]!
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

/** A length of time in seconds, to one decimal place: `6.1s`. */
export const seconds = (ms: number): string => `${(Math.max(ms, 0) / 1000).toFixed(1)}s`

/**
 * How long ago, for the "when" column on Home: "just now", "2 min ago",
 * "3 hours ago" (earlier today), "yesterday", "3 days ago", "2 weeks ago",
 * then the date. A time ahead of this machine's clock is shown as its date.
 * Empty when `at` is not a time.
 */
export function relativeTime(at: string, now: Date): string {
  const then = parse(at)
  if (!then) return ""
  const ago = now.getTime() - then.getTime()
  if (ago < -MINUTE) return day(then, now)
  if (ago < MINUTE) return "just now"
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`
  const days = calendarDays(then, now)
  if (days <= 0) return plural(Math.floor(ago / HOUR), "hour")
  if (days === 1) return "yesterday"
  if (days < 7) return plural(days, "day")
  if (days < 35) return plural(Math.floor(days / 7), "week")
  return day(then, now)
}

/**
 * The day and time, for an app's deploy history: "today 21:52",
 * "yesterday 21:47", "12 Nov 21:41", or "12 Nov 2025" in another year. A
 * later day than today is shown by its date. Empty when `at` is not a time.
 */
export function clockTime(at: string, now: Date): string {
  const then = parse(at)
  if (!then) return ""
  const days = calendarDays(then, now)
  if (days === 0) return `today ${clock(then)}`
  if (days === 1) return `yesterday ${clock(then)}`
  return then.getFullYear() === now.getFullYear() ? `${day(then, now)} ${clock(then)}` : day(then, now)
}
