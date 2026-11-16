/**
 * The rows a sentence takes on Home, as Ink wraps it (`inkRows`), and a
 * sentence cut into rows that fit (`rowsOf`): Home gives each part of the
 * screen only the rows the window leaves it (home.tsx).
 */
/**
 * Columns one character takes: two for the wide scripts (Hangul, the CJK
 * blocks, full-width forms) and for pictographs, one for anything else, the
 * marks and arrows zekno draws included.
 */
function columnsOf(char: string): number {
  const code = char.codePointAt(0)!
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  return wide ? 2 : 1
}
export const widthOf = (text: string): number =>
  [...text].reduce((sum, char) => sum + columnsOf(char), 0)

/**
 * The rows Ink draws a sentence of plain words in at `width` columns: wrapped
 * at spaces, a word longer than a row broken where the row ends, and a space
 * that falls just past a full row starting the next one, as Ink wraps.
 */
export function inkRows(text: string, width: number): number {
  const room = Math.max(width, 1)
  let rows = 1
  let used = 0
  text.split(" ").forEach((word, index) => {
    if (index > 0) {
      if (used >= room) {
        rows++
        used = 0
      }
      used++
    }
    const length = widthOf(word)
    if (used + length > room && used > 0 && length > 0) {
      rows++
      used = 0
    }
    used += length
    while (used > room) {
      rows++
      used -= room
    }
  })
  return rows
}

/**
 * `text` wrapped at spaces into rows of at most `width` columns, a word
 * longer than a row broken where the row ends, and at most `rows` of them.
 * When it does not fit, it is cut after the last word that does, with "…".
 * Each row is drawn as it is: Ink does not wrap it again.
 */
export function rowsOf(text: string, rows: number, width: number): string[] {
  if (rows <= 0) return []
  const room = Math.max(width, 2)
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    // A word longer than a row, such as a path, is broken into pieces that each fit one.
    const pieces: string[] = []
    let piece = ""
    for (const char of word) {
      if (widthOf(piece) + columnsOf(char) > room) {
        pieces.push(piece)
        piece = ""
      }
      piece += char
    }
    pieces.push(piece)
    for (const part of pieces) {
      const joined = line === "" ? part : `${line} ${part}`
      if (widthOf(joined) <= room) line = joined
      else {
        lines.push(line)
        line = part
      }
    }
  }
  if (line !== "") lines.push(line)
  if (lines.length <= rows) return lines
  const kept = lines.slice(0, rows)
  let last = kept[rows - 1]!
  // Room for "…" after the last whole word that fits; a single piece too long for it loses its end.
  while (widthOf(`${last}…`) > room) {
    const space = last.lastIndexOf(" ")
    last = space > 0 ? last.slice(0, space) : [...last].slice(0, -1).join("")
  }
  kept[rows - 1] = `${last}…`
  return kept
}
