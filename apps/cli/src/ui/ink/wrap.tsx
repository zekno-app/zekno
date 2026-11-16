/**
 * Words that wrap at a terminal as a person reads them (specs/006-cli-small-features,
 * quickstart.md, the walkthrough's difference 6): a line too long for the
 * window goes on at the column its text started at, and the space it broke
 * at is dropped. Ink's own wrapping keeps that space, at the start of the
 * next line, whenever the word before it filled the line to the last column,
 * so the next line started one column off.
 *
 * The words are broken here, into lines that each fit, before Ink draws them,
 * so Ink never has to break them again. Only single commands draw through
 * this; the plain interface never does.
 */
import { Box, Text } from "ink"

/**
 * A run of words in one look. `keep`: never broken at, such as the cursor of
 * a typed answer, which is drawn as a space.
 */
export type Piece = {
  text: string
  bold?: boolean
  dim?: boolean
  color?: string
  inverse?: boolean
  keep?: boolean
}

/** One character of the words, with the piece it came from. */
type Char = { char: string; width: number; piece: number }

/** The columns a character takes at a terminal. */
const columnsOf = (char: string): number => Bun.stringWidth(char)

/**
 * Breaks `pieces` into lines of at most `columns` columns, each a list of
 * pieces in their looks. A line breaks at a space, which is dropped there,
 * so the next line starts with a word; a word wider than a line is broken
 * where the line ends, as Ink does. A line break in the text starts a new
 * line. Spaces at the very start are kept.
 */
export function wrapPieces(
  pieces: readonly Piece[],
  columns: number
): Piece[][] {
  const lines: Char[][] = [[]]
  let used = 0
  let spaces: Char[] = []
  let word: Char[] = []
  const newLine = () => {
    lines.push([])
    used = 0
  }
  const place = (chars: Char[]) => {
    for (const char of chars) {
      if (used + char.width > columns && used > 0) newLine()
      lines.at(-1)!.push(char)
      used += char.width
    }
  }
  const endWord = () => {
    if (word.length === 0) return
    const wide = word.reduce((sum, char) => sum + char.width, 0)
    const room = spaces.reduce((sum, char) => sum + char.width, 0)
    if (used > 0 && used + room + wide > columns) {
      // A word wider than a whole line is broken anyway: as Ink does, it starts on this line, after its spaces,
      // unless starting on the next line saves a break. Otherwise the spaces before a word that does not fit are
      // where the line breaks: they are dropped, not carried over.
      const left = columns - used - room
      const here =
        left > 0
          ? 1 + Math.floor((wide - left - 1) / columns)
          : Number.POSITIVE_INFINITY
      const next = Math.floor((wide - 1) / columns)
      if (wide > columns && here <= next) place(spaces)
      else newLine()
    } else place(spaces)
    place(word)
    spaces = []
    word = []
  }
  pieces.forEach((piece, index) => {
    for (const char of piece.text) {
      if (char === "\n") {
        endWord()
        spaces = []
        newLine()
        continue
      }
      const entry = { char, width: columnsOf(char), piece: index }
      if (char === " " && piece.keep !== true) {
        if (word.length > 0) endWord()
        spaces.push(entry)
      } else {
        word.push(entry)
      }
    }
  })
  endWord()
  // Spaces at the very end stay when they fit; nothing follows them to start a line with.
  if (
    spaces.length > 0 &&
    used + spaces.reduce((sum, char) => sum + char.width, 0) <= columns
  )
    place(spaces)
  // Each line as runs of characters from one piece, in that piece's look.
  return lines.map((line) => {
    const runs: { piece: number; text: string }[] = []
    for (const { char, piece } of line) {
      const last = runs.at(-1)
      if (last?.piece === piece) last.text += char
      else runs.push({ piece, text: char })
    }
    return runs.map((run) => ({ ...pieces[run.piece]!, text: run.text }))
  })
}

/** One piece in its look. */
function Styled({ piece }: { piece: Piece }) {
  return (
    <Text
      bold={piece.bold === true}
      dimColor={piece.dim === true}
      color={piece.color}
      inverse={piece.inverse === true}
    >
      {piece.text}
    </Text>
  )
}

/** One line of pieces; an empty one is drawn as a space, as an empty line between blocks is. */
function Row({ line }: { line: readonly Piece[] }) {
  if (line.length === 0) return <Text> </Text>
  return (
    <Text>
      {line.map((piece, index) => (
        <Styled key={index} piece={piece} />
      ))}
    </Text>
  )
}

/**
 * Words in their looks, broken into lines of `columns` at most (`wrapPieces`).
 * Without a width, as when nothing tells the window's, they are drawn as one
 * text and left to Ink.
 */
export function Wrapped({
  pieces,
  columns,
}: {
  pieces: readonly Piece[]
  columns: number | undefined
}) {
  if (columns === undefined || !Number.isFinite(columns) || columns <= 0)
    return <Row line={pieces} />
  const lines = wrapPieces(pieces, columns)
  if (lines.length === 1) return <Row line={lines[0]!} />
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Row key={index} line={line} />
      ))}
    </Box>
  )
}
