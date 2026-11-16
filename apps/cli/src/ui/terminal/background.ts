/**
 * Whether the terminal's background is dark or light (research R15), so the
 * brand blue can be the one that reads best on it.
 *
 * The terminal is asked once, before the app draws anything: OSC 11 asks for
 * the background colour, and DA1 ("what are you?") follows it. Every terminal
 * answers DA1, and answers in order, so once the DA1 answer is in, any answer
 * to OSC 11 has arrived before it and nothing more is on its way. That is how
 * detection knows it has read all of what the terminal sent, and leaves no
 * byte of an answer to be read later as a key press.
 *
 * Anything that does not answer, does not make sense, or is not a terminal
 * means dark: a wrong guess costs a few slightly faint letters, nothing more.
 */
import type { Background } from "./theme"

/** A colour, each part from 0 to 1. */
export type Rgb = { r: number; g: number; b: number }

/** The background colour question (OSC 11), then DA1, whose answer marks the end of the answers. */
export const QUERY = "\x1b]11;?\x07\x1b[c"

/** How long to wait for a terminal that has said nothing at all. */
export const QUIET_MS = 200
/** How long to wait, at most, for a terminal that has begun to answer. */
export const ANSWERING_MS = 1000
/** Far more than both answers take. A terminal that sends more is not answering this question. */
const ANSWER_LIMIT = 1024

/** An answer to OSC 11: `rgb:` with three parts or `rgba:` with four, of 1 to 4 hex digits each, ended by BEL or ST. */
const COLOUR_ANSWER =
  /\x1b\]11;(rgba?):([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(?:\/([0-9a-fA-F]{1,4}))?(?:\x07|\x1b\\)/
/** The answer to DA1. */
const DA1_ANSWER = /\x1b\[\?[0-9;]*c/

/** One part of an X11 colour: `h`, `hh`, `hhh` or `hhhh`, scaled to 0 to 1. */
const part = (hex: string): number => parseInt(hex, 16) / (16 ** hex.length - 1)

/**
 * Reads the background colour from what a terminal answered. Undefined when
 * there is no complete answer in the text, or it is not one this reads.
 */
export function parseBackgroundAnswer(text: string): Rgb | undefined {
  const match = COLOUR_ANSWER.exec(text)
  if (!match) return undefined
  const [, kind, r, g, b, alpha] = match
  // `rgb:` has exactly three parts and `rgba:` exactly four.
  if ((kind === "rgba") !== (alpha !== undefined)) return undefined
  return { r: part(r!), g: part(g!), b: part(b!) }
}

/** Relative luminance, as WCAG defines it. */
function luminance({ r, g, b }: Rgb): number {
  const linear = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * Light when dark text would stand out more on it than light text: above
 * this luminance, black has the higher contrast ratio against it than white.
 */
const LIGHT_ABOVE = Math.sqrt(1.05 * 0.05) - 0.05

/** Dark or light, from a terminal's answer. Dark when there is no answer that makes sense. */
export function backgroundFrom(answer: string): Background {
  const colour = parseBackgroundAnswer(answer)
  return colour && luminance(colour) > LIGHT_ABOVE ? "light" : "dark"
}

/** Whether all a terminal is going to answer has arrived: the DA1 answer comes last. */
export const answered = (text: string): boolean => DA1_ANSWER.test(text)

/**
 * Whether a key press is really a piece of a terminal's late answer, as Ink
 * splits one: the body of an OSC 11 answer, or a DA1 answer without its
 * escape. Detection waits for both, so this only matters for a terminal
 * slower than detection's patience; such a piece is never taken as typing.
 */
export function isLateAnswer(input: string): boolean {
  return (
    /^(?:\d+;)?rgba?:[0-9a-fA-F/]*\x07?$/.test(input) ||
    /^\[\?[0-9;]*c$/.test(input)
  )
}

type Input = Pick<
  NodeJS.ReadStream,
  "isTTY" | "on" | "removeListener" | "read"
> & {
  isRaw?: boolean
  setRawMode?: (mode: boolean) => unknown
  ref?: () => unknown
  unref?: () => unknown
}
type Output = Pick<NodeJS.WriteStream, "isTTY" | "write">

/**
 * Asks the terminal for its background colour and says whether it is dark or
 * light. Does nothing at all, and says dark, when input or output is not a
 * terminal. The terminal's mode is put back as it was, whatever happens.
 *
 * Input is read the way Ink reads it: a `readable` listener that takes what
 * has arrived. It is never switched to a flowing `data` stream and never
 * paused. In Bun, a terminal's input that has flowed and been paused takes no
 * key afterwards and keeps a processor busy, so the app that opens next would
 * be deaf.
 */
export async function detectBackground(
  input: Input = process.stdin,
  output: Output = process.stdout,
  patience: { quietMs: number; answeringMs: number } = {
    quietMs: QUIET_MS,
    answeringMs: ANSWERING_MS,
  }
): Promise<Background> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function")
    return "dark"
  const wasRaw = input.isRaw === true
  let text = ""
  let onReadable: (() => void) | undefined
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    // Without raw mode the terminal would echo the answer and hold it until Enter.
    input.setRawMode(true)
    input.ref?.()
    await new Promise<void>((resolve) => {
      onReadable = () => {
        let chunk: Buffer | string | null
        while ((chunk = input.read() as Buffer | string | null) !== null) {
          text += typeof chunk === "string" ? chunk : chunk.toString("latin1")
          if (text.length > ANSWER_LIMIT) break
        }
        if (answered(text) || text.length > ANSWER_LIMIT) resolve()
      }
      input.on("readable", onReadable)
      timers.push(setTimeout(() => text === "" && resolve(), patience.quietMs))
      timers.push(setTimeout(resolve, patience.answeringMs))
      output.write(QUERY)
    })
  } catch {
    return "dark"
  } finally {
    for (const timer of timers) clearTimeout(timer)
    if (onReadable) input.removeListener("readable", onReadable)
    try {
      input.setRawMode(wasRaw)
    } catch {
      // The terminal went away. There is nothing left to put back.
    }
    // Nothing here keeps the program running any more. Ink takes the input again when the app opens.
    input.unref?.()
  }
  return backgroundFrom(text)
}
