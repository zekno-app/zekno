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
 */
import { Box, Text } from "ink"

import { SUMMARY } from "../../templates/add-words"
import type { AdditionReport } from "../../templates/types"
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
