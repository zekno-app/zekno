/**
 * Text that came from a server is drawn in the developer's terminal: Docker's
 * output, log lines, anything the runner or SSH wrote. A terminal acts on
 * control characters and escape sequences: it can move the cursor, clear or
 * redraw the screen, change the window title, write to the clipboard (OSC 52)
 * or show a link that goes somewhere other than it says (OSC 8). Invisible
 * characters can reorder or hide text. A server must never be able to do any
 * of that, so its text passes through `sanitize` before it is drawn.
 */

const ESC = 0x1b
const BEL = 0x07
/** String Terminator in its one-character form. */
const ST = 0x9c
const TAB_STOP = 8

/**
 * Invisible characters that change how the text around them is shown:
 * bidirectional overrides and isolates, zero-width spaces and joiners, the
 * byte order mark, tag characters (all of Unicode's "format" category), line
 * and paragraph separators, and unpaired surrogates.
 */
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u

/**
 * Characters Unicode says to draw as nothing when they are not understood:
 * Hangul fillers, the combining grapheme joiner, Mongolian and other
 * variation selectors, and code points kept for more of the same. They can
 * pad or hide text.
 */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u

/** The two variation selectors that choose between text and emoji form. Emoji keep their form. */
const EMOJI_FORM = new Set([0xfe0e, 0xfe0f])

const isControl = (code: number) =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f)
const isHidden = (code: number, char: string) =>
  INVISIBLE.test(char) || (IGNORABLE.test(char) && !EMOJI_FORM.has(code))
const inRange = (code: number | undefined, low: number, high: number) =>
  code !== undefined && code >= low && code <= high

/** Skips a control sequence's parameters, intermediates and final character. Returns where the text resumes. */
function skipCsi(codes: number[], start: number): number {
  let at = start
  while (inRange(codes[at], 0x30, 0x3f)) at++
  while (inRange(codes[at], 0x20, 0x2f)) at++
  // A sequence cut short by something else is dropped; what interrupted it is read as usual.
  return inRange(codes[at], 0x40, 0x7e) ? at + 1 : at
}

/**
 * Skips a control string (OSC, DCS, SOS, PM, APC) up to and including its
 * terminator: BEL, ESC \ or the one-character ST. Another ESC also ends it,
 * and is then read as the start of a new sequence. With no terminator, the
 * rest of the text is the string, as a terminal would take it.
 */
function skipString(codes: number[], start: number): number {
  for (let at = start; at < codes.length; at++) {
    const code = codes[at]
    if (code === BEL || code === ST) return at + 1
    if (code === ESC) return codes[at + 1] === 0x5c ? at + 2 : at
  }
  return codes.length
}

/** Skips an escape sequence that starts at `start` (an ESC). Returns where the text resumes. */
function skipEscape(codes: number[], start: number): number {
  const next = codes[start + 1]
  if (next === 0x5b) return skipCsi(codes, start + 2) // ESC [
  // ESC ] (OSC), ESC P (DCS), ESC X (SOS), ESC ^ (PM), ESC _ (APC)
  if (
    next === 0x5d ||
    next === 0x50 ||
    next === 0x58 ||
    next === 0x5e ||
    next === 0x5f
  )
    return skipString(codes, start + 2)
  let at = start + 1
  while (inRange(codes[at], 0x20, 0x2f)) at++
  // ESC c, ESC 7, ESC ( B, ESC # 8 and the like. A lone ESC is dropped by itself.
  return inRange(codes[at], 0x30, 0x7e) ? at + 1 : at
}

/**
 * Makes one line of text from a server safe to draw: every control character
 * and escape sequence is removed (7-bit and 8-bit forms, complete or cut off),
 * invisible formatting characters and characters drawn as nothing are removed
 * (but for the two that pick an emoji's form), and a tab becomes spaces up to
 * the next tab stop. Ordinary text in any script, and emoji, are kept. Never
 * throws, whatever the input.
 */
export function sanitize(text: string): string {
  const codes = Array.from(text, (char) => char.codePointAt(0)!)
  let out = ""
  let column = 0
  let at = 0
  while (at < codes.length) {
    const code = codes[at]!
    if (code === ESC) {
      at = skipEscape(codes, at)
    } else if (code === 0x9b) {
      at = skipCsi(codes, at + 1) // CSI in its one-character form
    } else if (
      code === 0x9d ||
      code === 0x90 ||
      code === 0x98 ||
      code === 0x9e ||
      code === 0x9f
    ) {
      at = skipString(codes, at + 1) // OSC, DCS, SOS, PM, APC in their one-character forms
    } else if (code === 0x09) {
      const spaces = TAB_STOP - (column % TAB_STOP)
      out += " ".repeat(spaces)
      column += spaces
      at++
    } else {
      const char = String.fromCodePoint(code)
      if (!isControl(code) && !isHidden(code, char)) {
        out += char
        column++
      }
      at++
    }
  }
  return out
}
