/**
 * `zekno add`'s summary at a terminal, before it asks (specs/012-templates,
 * contracts/commands.md, "a settings file, at a terminal"; board
 * `AddTemplate`, left column; plan.md, D24, D26, D30, D31, D32): the title
 * line, the box of the app, the server and the file (the panel and field rows
 * `zekno deploy`'s summary is drawn with, ui/parts/), then each block from
 * column 0 with its rows from column 2, names padded to 24 and values from
 * column 26, no empty line between blocks, then the notes in the warning
 * colour. Every value is a name that passed its rule or fixed words; a made
 * value is `••••`, dim.
 *
 * Then the lines for a Compose file written by hand (contracts/commands.md,
 * "A hand-written Compose file"; board `AddOther`, left column): AH1 to AH5,
 * the service's lines and the connection secrets' lines each in a box with a
 * faint border, in the text colour. They name secrets, never a value.
 */
import { Box, Text } from "ink"

import { AH1, AH2, AH3, AH4, AH5, SUMMARY } from "../../templates/add-words"
import type { AdditionReport, HandLines } from "../../templates/types"
import { Fields } from "../parts/fields"
import { Panel } from "../parts/panel"
import { BRAND } from "../terminal/theme"
import { COLOR, MARK, MarkedLine } from "./marks"
import { Wrapped, type Piece } from "./wrap"

/** The widest the summary gets, so it fits a window of 80 by 24 (D30). A narrower window gets a box as wide as it is. */
export const SUMMARY_WIDTH = 80

/** Where a row's name starts, and how wide its column is: values start at column 26 (research R11). */
const ROW_INDENT = 2
const NAME_COLUMN = 24

/** The box's label column: `server` and two spaces. */
const BOX_LABELS = 8

/** One row of a block: the name in its column, in its look, and the value's pieces, going on under the value column. */
function Row({
  name = "",
  look,
  pieces,
  columns,
}: {
  name?: string
  look?: { bold?: boolean; color?: string }
  pieces: readonly Piece[]
  columns: number
}) {
  return (
    <Box paddingLeft={ROW_INDENT} width={columns}>
      <Box width={NAME_COLUMN} flexShrink={0}>
        <Text bold={look?.bold} color={look?.color}>
          {name}
        </Text>
      </Box>
      <Wrapped
        pieces={pieces}
        columns={Math.max(1, columns - ROW_INDENT - NAME_COLUMN)}
      />
    </Box>
  )
}

/** A block's heading, bold, with dim words after it when there are any. */
function Heading({
  text,
  after,
  columns,
}: {
  text: string
  after?: string
  columns: number
}) {
  return (
    <Wrapped
      pieces={[
        { text, bold: true },
        ...(after === undefined ? [] : [{ text: `  ${after}`, dim: true }]),
      ]}
      columns={columns}
    />
  )
}

/** The summary of `report`, drawn `columns` wide. */
export function AdditionBlock({
  report,
  columns,
}: {
  report: AdditionReport
  columns: number
}) {
  const width = Math.max(4, Math.min(columns, SUMMARY_WIDTH))
  const head = `${report.title} ${report.software}`
  const by = SUMMARY.by(report.author)
  // `by <author>` ends at the box's right edge; two spaces after the about when the window is too narrow.
  const gap = Math.max(
    2,
    width - head.length - 2 - report.about.length - by.length
  )
  const several = report.offers.some((offer) => offer.usesSeveral)
  return (
    <Box flexDirection="column" width={Math.max(4, columns)}>
      <Wrapped
        pieces={[
          { text: head, bold: true },
          { text: "  " },
          { text: report.about, dim: true },
          { text: " ".repeat(gap) },
          { text: by, dim: true, keep: true },
        ]}
        columns={columns}
      />
      <Box width={width}>
        <Panel tone="plain" flexGrow={1}>
          <Fields
            labelWidth={BOX_LABELS}
            rows={[
              [SUMMARY.app, <Text bold>{report.app}</Text>],
              [
                SUMMARY.server,
                <Text>
                  {report.server.name}
                  <Text dimColor> {report.server.where}</Text>
                </Text>,
              ],
              [
                SUMMARY.file,
                <Text>
                  {report.file.shown}
                  <Text dimColor>
                    {"  "}
                    {report.file.detail}
                  </Text>
                </Text>,
              ],
            ]}
          />
        </Panel>
      </Box>
      <Heading text={SUMMARY.adds(report.services.length)} columns={columns} />
      {report.services.map((service) => (
        <Box key={service.name} flexDirection="column">
          <Row
            name={service.name}
            look={{ bold: true, color: BRAND }}
            pieces={[
              { text: service.image },
              { text: `  ${SUMMARY.pinned}`, dim: true },
            ]}
            columns={columns}
          />
          {service.rule === undefined && service.port === undefined ? null : (
            <Row
              pieces={[
                ...(service.rule === undefined ? [] : [{ text: service.rule }]),
                ...(service.rule !== undefined && service.port !== undefined
                  ? [{ text: SUMMARY.dot, dim: true }]
                  : []),
                ...(service.port === undefined ? [] : [{ text: service.port }]),
              ]}
              columns={columns}
            />
          )}
          {service.volumes.length === 0 ? null : (
            <Row
              pieces={[{ text: SUMMARY.volumes(service.volumes) }]}
              columns={columns}
            />
          )}
        </Box>
      ))}
      <Heading
        text={SUMMARY.makes(report.made.length)}
        after={SUMMARY.neverShown}
        columns={columns}
      />
      {report.made.map((made) => (
        <Box key={made.name} flexDirection="column">
          <Row
            name={made.name}
            pieces={[{ text: SUMMARY.random(made.length) }]}
            columns={columns}
          />
          <Row
            pieces={[{ text: SUMMARY.readBy(made.readBy), dim: true }]}
            columns={columns}
          />
        </Box>
      ))}
      {report.offers.length === 0 ? null : (
        <Heading text={SUMMARY.builds(several)} columns={columns} />
      )}
      {report.offers.map((offer) => (
        <Box key={offer.name} flexDirection="column">
          <Row
            name={offer.name}
            pieces={offer.pieces.map((piece) =>
              piece.hidden
                ? { text: piece.text, dim: true }
                : { text: piece.text }
            )}
            columns={columns}
          />
          <Row
            pieces={[{ text: SUMMARY.readBy(offer.readBy), dim: true }]}
            columns={columns}
          />
        </Box>
      ))}
      {report.notes.map((note, index) => (
        <MarkedLine
          key={index}
          mark={MARK.warn}
          color={COLOR.warn}
          pieces={[{ text: note, color: COLOR.warn }]}
          columns={columns}
        />
      ))}
    </Box>
  )
}

/**
 * Lines a person copies, in a box with a faint border, in the text colour,
 * each from the box's second column (board `AddOther`): the box two columns
 * wider than the longest line, as the contract draws the connection
 * secret's, or as wide as the window. A line wider than the box goes on
 * under itself, inside it.
 */
function LinesBox({
  lines,
  columns,
}: {
  lines: readonly string[]
  columns: number
}) {
  const longest = Math.max(0, ...lines.map((line) => Bun.stringWidth(line)))
  const width = Math.max(5, Math.min(columns, longest + 5))
  return (
    <Box width={width}>
      <Panel tone="plain" flexGrow={1}>
        {lines.map((line, index) => (
          <Wrapped key={index} pieces={[{ text: line }]} columns={width - 4} />
        ))}
      </Panel>
    </Box>
  )
}

/** A sentence that starts with `Under `, dim, and goes on in the text colour (AH3, AH4). */
const under = (sentence: string): Piece[] => [
  { text: "Under ", dim: true },
  { text: sentence.slice("Under ".length) },
]

/** The lines for a Compose file written by hand, drawn `columns` wide (board `AddOther`, left column). */
export function HandBlock({
  lines,
  columns,
}: {
  lines: HandLines
  columns: number
}) {
  // AH1 with the file bold: the sentence split where the file goes, never by looking for the file's name in it.
  const [before = "", after = ""] = AH1("\0").split("\0")
  const [inThe = "", ofEach = ""] = AH5.split("environment:")
  return (
    <Box flexDirection="column" width={Math.max(5, columns)}>
      <Wrapped
        pieces={[
          { text: before },
          { text: lines.file, bold: true },
          { text: after },
        ]}
        columns={columns}
      />
      <Wrapped pieces={[{ text: AH2, dim: true }]} columns={columns} />
      <Wrapped pieces={under(AH3)} columns={columns} />
      <LinesBox lines={lines.service} columns={columns} />
      {lines.volumes.length === 0 ? null : (
        <Wrapped pieces={under(AH4(lines.volumes))} columns={columns} />
      )}
      {lines.offers.length === 0 ? null : (
        <>
          <Wrapped
            pieces={[
              { text: inThe, dim: true },
              { text: "environment:" },
              { text: ofEach, dim: true },
            ]}
            columns={columns}
          />
          <LinesBox lines={lines.offers} columns={columns} />
        </>
      )}
    </Box>
  )
}
