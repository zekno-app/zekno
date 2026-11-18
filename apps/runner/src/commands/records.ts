/**
 * `records`: the statements of the secret records the runner keeps for one
 * app, in a session only (specs/014-deploy-v2; contracts/protocol.md P5, P6).
 * A read: it takes no lock and changes nothing. It gives each live secret's
 * statement (name, version, hash and who set it), never a sealed value, so a
 * deployer can list a secret the server holds without its value passing
 * through the deployer's machine. The deployer verifies every statement
 * itself; the runner's word decides nothing.
 */
import {
  LIMITS,
  parseMessage,
  RunnerRecordsRequestSchema,
  SESSION_FRAME_BYTES,
  type Envelope,
  type RunnerRecords,
  type RunnerReport,
} from "@workspace/core"

import { readRecord } from "../home/records"
import { isReport, load, refused } from "./commands"

/** Bytes the answer takes as the session writes it: one result frame and its line feed. */
const frameBytes = (answer: RunnerRecords) =>
  Buffer.byteLength(JSON.stringify({ result: answer })) + 1

/**
 * For each secret of `app` with a live version, sorted by name, the statement
 * of its record file when that file exists and reads. An app the runner does
 * not hold, and one still at format 1 (its secrets came by version 1, which
 * keeps no record), have none. A statement longer than
 * `LIMITS.statementPayloadLength` is left out, as a file that does not read
 * is: a runner from before that limit may keep one, padded, and it would
 * otherwise make every answer too large for good; the deployer then stops
 * with C5 for that name, whose fix works offline (security review S2). An
 * answer that would not fit its frame (`SESSION_FRAME_BYTES.records`) or its
 * schema is refused `too_large` instead of sent: a reader would refuse it
 * anyway. Within the statement limit only the schema's count can be passed.
 */
export function records(
  dir: string,
  input: string
): RunnerRecords | RunnerReport {
  const request = parseMessage(RunnerRecordsRequestSchema, input)
  if (!request.ok) return refused("invalid_request")
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const { app } = request.value
  const { state } = loaded
  if (!Object.hasOwn(state.formats, app) || state.formats[app] !== 2)
    return { statements: [] }

  const prefix = `${app}/`
  const live = Object.entries(state.secrets)
    .filter(([key, entry]) => key.startsWith(prefix) && entry.hash !== null)
    .map(([key, entry]) => ({
      name: key.slice(prefix.length),
      hash: entry.hash!,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const statements: Envelope[] = []
  for (const { hash } of live) {
    const record = readRecord(dir, app, hash)
    if (
      record &&
      record.envelope.payload.length <= LIMITS.statementPayloadLength
    )
      statements.push(record.envelope)
  }
  const answer: RunnerRecords = { statements }
  if (
    statements.length > LIMITS.secretsPerDeploy ||
    frameBytes(answer) > SESSION_FRAME_BYTES.records
  )
    return refused("too_large")
  return answer
}
