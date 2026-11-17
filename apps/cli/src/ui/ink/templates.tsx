/**
 * `zekno add --list` and `zekno add <template> --show` at a terminal
 * (specs/012-templates, contracts/commands.md, "`zekno add --list`" and
 * "`zekno add <template> --show`"; board `AddLook`; plan.md, D24, D25, D30).
 *
 * The list: one line per template from column 2, the name bold, `<title>
 * <software>` in the text colour, the about dim, `by <author>` dim, each
 * column padded to its longest plus two. The view: the title line, then each
 * service in the sections grid `zekno settings` draws (settings-report.tsx),
 * the secrets, Good to know and `Nothing was changed.`, every line from
 * column 2 and no empty line between blocks (D30). Every value is a name or
 * a word that passed its rule in the template's strict reader, or fixed
 * words; the grid's rows were cleaned where they were made.
 */
import { Box, Text } from "ink"

import { AV1, AV2, AV5, AV6, SUMMARY } from "../../templates/add-words"
import type { TemplateRow, TemplateView } from "../../templates/types"
import { useTheme } from "../terminal/theme"
import { labelWidth, SECTION_WIDTH, SettingRowLine } from "./settings-report"
import { Wrapped, type Piece } from "./wrap"

/** Every line starts at column 2, as the board draws them. */
const INDENT = 2
/** The secrets' name column: their words from column 26, as the summary's rows (research R11). */
const NAME_COLUMN = 24

/** A column as wide as its longest text plus two. */
const widthOf = (texts: readonly string[]): number =>
  Math.max(0, ...texts.map((text) => [...text].length)) + 2

/** Words from column 2, going on under themselves when the window is narrower. */
function Indented({
  pieces,
  columns,
}: {
  pieces: readonly Piece[]
  columns: number
}) {
  return (
    <Box paddingLeft={INDENT}>
      <Wrapped pieces={pieces} columns={Math.max(1, columns - INDENT)} />
    </Box>
  )
}

/** `zekno add --list`, drawn `columns` wide. */
export function TemplateListBlock({
  rows,
  columns,
}: {
  rows: readonly TemplateRow[]
  columns: number
}) {
  const name = widthOf(rows.map((row) => row.name))
  const middle = widthOf(rows.map((row) => `${row.title} ${row.software}`))
  const about = widthOf(rows.map((row) => row.about))
  return (
    <Box flexDirection="column" width={columns}>
      {rows.map((row) => {
        const head = `${row.title} ${row.software}`
        return (
          <Indented
            key={row.name}
            pieces={[
              { text: row.name, bold: true },
              { text: " ".repeat(name - [...row.name].length) },
              { text: head.padEnd(middle) },
              { text: row.about, dim: true },
              { text: " ".repeat(about - [...row.about].length) },
              { text: SUMMARY.by(row.author), dim: true },
            ]}
            columns={columns}
          />
        )
      })}
    </Box>
  )
}

/** A heading of the view, bold, from column 2. */
const Heading = ({ text, columns }: { text: string; columns: number }) => (
  <Indented pieces={[{ text, bold: true }]} columns={columns} />
)

/** A secret's row: its name in the text colour, padded to 24, and its words dim. */
function SecretRow({
  name,
  words,
  columns,
}: {
  name: string
  words: string
  columns: number
}) {
  return (
    <Box paddingLeft={INDENT} width={columns}>
      <Box width={NAME_COLUMN} flexShrink={0}>
        <Text>{name}</Text>
      </Box>
      <Wrapped
        pieces={[{ text: words, dim: true }]}
        columns={Math.max(1, columns - INDENT - NAME_COLUMN)}
      />
    </Box>
  )
}

/** `zekno add <template> --show`, drawn `columns` wide. */
export function TemplateViewBlock({
  view,
  columns,
}: {
  view: TemplateView
  columns: number
}) {
  const theme = useTheme()
  const label = labelWidth(view)
  const value = Math.max(1, columns - INDENT - SECTION_WIDTH - label)
  return (
    <Box flexDirection="column" width={columns}>
      <Indented
        pieces={[
          { text: `${view.title} ${view.software}`, bold: true },
          { text: "  " },
          { text: `${view.about} ${AV1(view.author)}`, dim: true },
        ]}
        columns={columns}
      />
      {view.services.map((service, at) => (
        <Box key={`service-${at}`} flexDirection="column">
          <Box paddingLeft={INDENT}>
            <Text bold color={theme.brand}>
              {service.name}
            </Text>
          </Box>
          {service.rows.map((row, index) => (
            <SettingRowLine
              key={`row-${index}`}
              row={row}
              first={
                index === 0 || service.rows[index - 1]!.section !== row.section
              }
              label={label}
              value={value}
            />
          ))}
        </Box>
      ))}
      <Heading text={AV2.heading} columns={columns} />
      {view.made.map((made) => (
        <SecretRow
          key={`made-${made.name}`}
          name={made.name}
          words={AV2.made(made.length)}
          columns={columns}
        />
      ))}
      {view.offers.map((offer) => (
        <SecretRow
          key={`offer-${offer.name}`}
          name={offer.name}
          words={AV2.built(offer.usesSeveral)}
          columns={columns}
        />
      ))}
      <Heading text={AV6} columns={columns} />
      {view.good.map((line, at) => (
        <Indented
          key={`good-${at}`}
          pieces={[{ text: line, dim: true }]}
          columns={columns}
        />
      ))}
      <Indented pieces={[{ text: AV5, dim: true }]} columns={columns} />
    </Box>
  )
}
