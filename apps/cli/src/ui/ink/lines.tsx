/**
 * The lines single commands write at a terminal, each once, above whatever is
 * live (`Line`, drawn in Ink's Static by ink.tsx): results, warnings and
 * errors after their marks, notes, fields, tables, lines of cells, a
 * server's lines, the lines of `zekno logs`, codes, groups, a deploy that
 * ended, `zekno doctor`'s report, and what a question leaves behind
 * (left-behind.ts).
 */
import { Box, Text } from "ink"

import { logClock } from "../../shared/time"
import type { DoctorReport } from "../../ops/doctor"
import { DeployBlock, type DeployShown } from "./deploy-view"
import { answerPieces, QuestionLine, questionPieces } from "./questions"
import { BRAND } from "../terminal/theme"
import { REMOTE_MARK, type Cell, type LogOutput } from "../types"
import { CellText, drawnCell, linePieces } from "./cells"
import { DoctorBlock } from "./doctor-report"
import { hiddenPieces } from "./hidden-prompts"
import { COLOR, inside, MARK, MarkedLine, withoutBackticks } from "./marks"
import { yesOrNoPieces } from "./yes-or-no"
import { Wrapped, type Piece } from "./wrap"

export type Item =
  | { id: number; kind: "info" | "error" | "remote" | "note"; text: string }
  /**
   * `detail`: dim, two spaces after the words (`✔ Runner installed  52 MB, checksum verified`, board "zekno deploy from nothing").
   * `firstBold`: the first sentence in bold (`✔ Stored 4 values for demo on prod.`, board "zekno secret import").
   */
  | {
      id: number
      kind: "success"
      text: string
      detail?: string
      firstBold?: boolean
    }
  /** `firstBold`: the first sentence in bold (`zekno version`'s newer release, board "The version, and a newer release"). */
  | { id: number; kind: "warn"; text: string; firstBold?: boolean }
  | { id: number; kind: "field"; label: string; value: string }
  | { id: number; kind: "table"; rows: Cell[][] }
  | { id: number; kind: "log"; line: LogOutput; serviceWidth: number }
  | { id: number; kind: "line"; cells: readonly Cell[] }
  | { id: number; kind: "deploy"; shown: DeployShown }
  | { id: number; kind: "chosen"; collapsed: string; label: string }
  | { id: number; kind: "asked"; question: string; answer: string }
  /**
   * A question left with Esc or Ctrl-C: its line stays as it was drawn, above what is said next (board
   * "Questions in single commands"). `form` says how its line ends: a list's question alone; a typed
   * answer's `› <answer so far>` (`answer`), without the cursor; a yes-or-no question's `(y/N)`; the hidden
   * prompt's `(hidden)   esc skips it`, which never shows anything of a value.
   */
  | {
      id: number
      kind: "left"
      question: string
      form: "list" | "typed" | "yes-or-no" | "hidden"
      answer?: string
    }
  | { id: number; kind: "answered"; question: string; yes: boolean }
  | { id: number; kind: "hidden"; question: string; skipped: boolean }
  | { id: number; kind: "code"; label: string; value: string; about: string }
  | { id: number; kind: "groups"; rows: readonly (readonly [string, string])[] }
  | { id: number; kind: "gap" }
  | { id: number; kind: "doctor"; report: DoctorReport }

/** A sentence's end: a full stop before a space or a line break. */
const SENTENCE_END = /\.(?=\s)/

/**
 * An error as the board "Status, lists, errors and piped output" draws it:
 * its first sentence, in bold after ✖, and the rest faint on the lines
 * below, in line with that sentence. Commands are drawn as the board draws
 * them, without the backticks plain output keeps around them.
 */
export function ErrorLine({
  text,
  columns,
}: {
  text: string
  columns?: number
}) {
  const shown = withoutBackticks(text)
  const end = shown.search(SENTENCE_END)
  const first = end === -1 ? shown : shown.slice(0, end + 1)
  const rest = end === -1 ? "" : shown.slice(end + 1).trim()
  return (
    <Box flexDirection="column">
      <MarkedLine
        mark={MARK.error}
        color={COLOR.error}
        pieces={[{ text: first, bold: true }]}
        columns={columns}
      />
      {rest ? (
        <Box paddingLeft={2}>
          <Wrapped
            pieces={[{ text: rest, dim: true }]}
            columns={inside(columns, 2)}
          />
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * One line of `zekno logs` at a terminal, as on the board "Live logs": the
 * time, faint; the service; the text. A line wider than the terminal goes on
 * under its own text, never at the left edge, so the part after the wrap
 * cannot pass for a line with a time and a service of its own. `columns`
 * bounds it, as for a server's line (`RemoteLine`).
 */
export function LogItem({
  line,
  serviceWidth,
  columns,
}: {
  line: LogOutput
  serviceWidth: number
  columns?: number
}) {
  return (
    <Box width={columns}>
      <Box flexShrink={0} width={10}>
        <Text dimColor>{logClock(line.time)}</Text>
      </Box>
      <Box flexShrink={0} width={serviceWidth + 2}>
        <Text color={BRAND} wrap="truncate-end">
          {line.service}
        </Text>
      </Box>
      <Text>{line.text}</Text>
    </Box>
  )
}

export function Line({ item, columns }: { item: Item; columns: number }) {
  if (item.kind === "field") {
    return (
      <Text>
        {"  "}
        <Text dimColor>{item.label}</Text> <Text bold>{item.value}</Text>
      </Text>
    )
  }
  if (item.kind === "table") {
    const widths =
      item.rows[0]?.map((_, column) =>
        Math.max(...item.rows.map((row) => drawnCell(row[column]).length))
      ) ?? []
    // At the left edge, as the board's lists: a bare first column in the text colour, the others faint.
    return (
      <Box flexDirection="column">
        {item.rows.map((row, index) => (
          <Text key={index}>
            {row.map((cell, column) => (
              <CellText
                key={column}
                cell={cell}
                text={drawnCell(cell).padEnd((widths[column] ?? 0) + 2)}
                bare={column > 0 ? "quiet" : "plain"}
              />
            ))}
          </Text>
        ))}
      </Box>
    )
  }
  if (item.kind === "line")
    return <Wrapped pieces={linePieces(item.cells)} columns={columns} />
  if (item.kind === "log")
    return (
      <LogItem
        line={item.line}
        serviceWidth={item.serviceWidth}
        columns={columns}
      />
    )
  if (item.kind === "chosen") {
    return (
      <MarkedLine
        mark={MARK.success}
        color={COLOR.success}
        pieces={[
          { text: item.collapsed, dim: true },
          { text: `  ${item.label}` },
        ]}
        columns={columns}
      />
    )
  }
  if (item.kind === "asked")
    return (
      <QuestionLine
        pieces={[
          ...questionPieces(item.question),
          ...answerPieces(item.answer),
        ]}
        columns={columns}
      />
    )
  if (item.kind === "left") {
    const end: Piece[] =
      item.form === "typed"
        ? answerPieces(item.answer ?? "")
        : item.form === "yes-or-no"
          ? yesOrNoPieces
          : item.form === "hidden"
            ? hiddenPieces
            : []
    return (
      <QuestionLine
        pieces={[...questionPieces(item.question), ...end]}
        columns={columns}
      />
    )
  }
  if (item.kind === "answered") {
    return (
      <QuestionLine
        pieces={[
          ...questionPieces(item.question),
          ...yesOrNoPieces,
          { text: ` ${item.yes ? "yes" : "no"}` },
        ]}
        columns={columns}
      />
    )
  }
  if (item.kind === "hidden") {
    return (
      <QuestionLine
        pieces={[
          ...questionPieces(item.question),
          { text: item.skipped ? "skipped" : "(hidden)", dim: true },
        ]}
        columns={columns}
      />
    )
  }
  if (item.kind === "code") {
    // The code at column 15, as mock-up 3 draws the team code and the server code; what it is for on the line under it.
    return (
      <Box flexDirection="column" width={columns}>
        <Text>
          {"  "}
          <Text dimColor>{item.label.padEnd(CODE_LABEL)}</Text>
          {"  "}
          <Text bold>{item.value}</Text>
        </Text>
        <Box paddingLeft={2}>
          <Wrapped
            pieces={[{ text: item.about, dim: true }]}
            columns={columns - 2}
          />
        </Box>
      </Box>
    )
  }
  if (item.kind === "groups") {
    // Each text in a column of its own from column 14, as mock-up 4 draws the groups of an import.
    return (
      <Box flexDirection="column" width={columns}>
        {item.rows.map(([label, text], index) => (
          <Box key={index} paddingLeft={2}>
            <Box width={GROUP_LABEL} flexShrink={0}>
              <Text dimColor>{label}</Text>
            </Box>
            {/* A reason in brackets, such as "(zekno keeps this name)", is dim (board "zekno secret import"). */}
            <Wrapped
              pieces={text
                .split(/(\([^()]*\))/)
                .map((part, at) => ({ text: part, dim: at % 2 === 1 }))}
              columns={columns - 2 - GROUP_LABEL}
            />
          </Box>
        ))}
      </Box>
    )
  }
  if (item.kind === "gap") return <Text> </Text>
  if (item.kind === "doctor")
    return <DoctorBlock report={item.report} columns={columns} />
  if (item.kind === "note") {
    return (
      <Box paddingLeft={2} width={columns}>
        <Wrapped
          pieces={[{ text: item.text, dim: true }]}
          columns={columns - 2}
        />
      </Box>
    )
  }
  if (item.kind === "deploy")
    return <DeployBlock shown={item.shown} columns={columns} />

  if (item.kind === "info") {
    // Indented as a block, so text of several lines stays aligned with the marked lines.
    return (
      <Box marginLeft={2}>
        <Wrapped pieces={[{ text: item.text }]} columns={columns - 2} />
      </Box>
    )
  }
  if (item.kind === "remote")
    return <RemoteLine text={item.text} columns={columns} />
  if (item.kind === "error")
    return <ErrorLine text={item.text} columns={columns} />
  const pieces: Piece[] =
    (item.kind === "success" || item.kind === "warn") && item.firstBold === true
      ? questionPieces(item.text)
      : item.kind === "success" && item.detail !== undefined
        ? [{ text: `${item.text}  ` }, { text: item.detail, dim: true }]
        : [{ text: item.text }]
  return (
    <MarkedLine
      mark={MARK[item.kind]}
      color={COLOR[item.kind]}
      pieces={pieces}
      columns={columns}
    />
  )
}

/**
 * A line from a server: dim, after the mark. A line wider than the terminal
 * goes on under its own text, never at the left edge where zekno's marked
 * lines start, so the part after the wrap cannot pass for one of them.
 * Single commands draw it among the lines already written, where nothing
 * bounds its width: `columns` does, so a word longer than the room left,
 * such as a path, is broken here and not by the terminal.
 */
export function RemoteLine({
  text,
  columns,
}: {
  text: string
  columns?: number
}) {
  return (
    <Box width={columns}>
      <Box flexShrink={0} marginRight={1}>
        <Text dimColor>{REMOTE_MARK}</Text>
      </Box>
      <Text dimColor>{text}</Text>
    </Box>
  )
}

/** The label column of a code (mock-up 3) and of the groups of an import (mock-up 4). */
const CODE_LABEL = 11
const GROUP_LABEL = 12
