/**
 * `zekno doctor`'s report at a terminal (specs/006-cli-small-features,
 * contracts/doctor.md, "At a terminal"; board "zekno doctor", mock-up 5):
 * each check a row with its mark, label, detail and next step, this machine
 * first, then each server, then the counts.
 */
import { Box, Text } from "ink"

import type { CheckLine, DoctorReport } from "../../ops/doctor"
import { doctorCounts, SERVERS_SKIPPED } from "../types"
import { COLOR, MARK, withoutBackticks } from "./marks"
import { Wrapped } from "./wrap"

/** Where a check's detail and its next step start in `zekno doctor`'s report: column 17 (mock-up 5). */
const CHECK_DETAIL = 17

/** The mark and colour of each result (mock-up 5): never colour alone, the mark says it too. */
const CHECK_MARK = { good: [MARK.success, COLOR.success], warning: [MARK.warn, COLOR.warn], problem: [MARK.error, COLOR.error] } as const

/**
 * One check of `zekno doctor` (contracts/doctor.md, "At a terminal"; board
 * "zekno doctor"): the mark in its colour, a space, the label, and the detail
 * from column 17, which goes on in its own column when it is wider than the
 * window; the next step dim under it, from column 17. A check not checked is
 * `–`, two spaces, its label, and `not checked`, the mark and the words dim.
 */
function CheckRow({ check, columns }: { check: CheckLine; columns: number }) {
  if (check.result === "not checked") {
    return (
      <Box width={columns}>
        <Box width={CHECK_DETAIL} flexShrink={0}>
          <Text>
            <Text dimColor>–</Text>
            {"  "}
            {check.label}
          </Text>
        </Box>
        <Text dimColor>not checked</Text>
      </Box>
    )
  }
  const [mark, color] = CHECK_MARK[check.result]
  return (
    <Box flexDirection="column" width={columns}>
      <Box>
        <Box width={CHECK_DETAIL} flexShrink={0}>
          <Text>
            <Text color={color}>{mark}</Text> {check.label}
          </Text>
        </Box>
        <Wrapped pieces={[{ text: check.detail }]} columns={columns - CHECK_DETAIL} />
      </Box>
      {check.next === undefined ? null : (
        <Box paddingLeft={CHECK_DETAIL}>
          {/* A command in a next step is drawn as an error line draws one: without its backticks. Plain output keeps them. */}
          <Wrapped pieces={[{ text: withoutBackticks(check.next), dim: true }]} columns={columns - CHECK_DETAIL} />
        </Box>
      )}
    </Box>
  )
}

/**
 * `zekno doctor`'s report at a terminal (mock-up 5, board "zekno doctor"):
 * `This machine` and each server's name in bold from column 2, where the
 * server is dim two spaces after its name, an empty line before each server
 * and before the last line, which is bold. When no server was checked, D31,
 * dim, in place of the servers.
 */
export function DoctorBlock({ report, columns }: { report: DoctorReport; columns: number }) {
  return (
    <Box flexDirection="column" width={columns}>
      <Box paddingLeft={2}>
        <Text bold>This machine</Text>
      </Box>
      {report.machine.map((check, index) => (
        <CheckRow key={`machine-${index}`} check={check} columns={columns} />
      ))}
      {report.serversSkipped ? (
        <Box flexDirection="column">
          <Text> </Text>
          <Box paddingLeft={2}>
            <Text dimColor>{SERVERS_SKIPPED}</Text>
          </Box>
        </Box>
      ) : (
        report.servers.map((server, at) => (
          <Box key={`server-${at}`} flexDirection="column">
            <Text> </Text>
            <Box paddingLeft={2}>
              <Text>
                <Text bold>{server.name}</Text>
                {"  "}
                <Text dimColor>{server.where}</Text>
              </Text>
            </Box>
            {server.checks.map((check, index) => (
              <CheckRow key={`${at}-${index}`} check={check} columns={columns} />
            ))}
          </Box>
        ))
      )}
      <Text> </Text>
      <Box paddingLeft={2}>
        <Text bold>{doctorCounts(report.problems, report.warnings)}</Text>
      </Box>
    </Box>
  )
}
