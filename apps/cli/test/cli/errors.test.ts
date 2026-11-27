/**
 * A runner's refusals, as the CLI says them (specs/014-deploy-v2, SC-011;
 * contracts/cli.md, "Every line", R1 to R8; research R15; tasks T028): every
 * reason a `deploy` or `apply` check can give has a sentence of its own, the
 * version-2 sentences only for a deploy signed as version 2, and today's
 * sentences for everything else, word for word as at e7b0146. Protocol 6's
 * five refusals (specs/016-build-from-source, contracts/core.md CO10;
 * contracts/cli.md CL7, "The answer") say, until the words tasks, the id of
 * their row of that feature's design/lines.md: no sentence is written in a
 * logic task (FR-092; tasks T104).
 */
import { describe, expect, test } from "bun:test"
import {
  DEPLOY_REFUSALS,
  DEPLOY_V2_REFUSALS,
  RUNNER_REFUSALS,
} from "@workspace/core"

import { explain, explainDeploy, RunnerRefused } from "../../src/cli/errors"
import { fitsOneLine, keepsTheHabits } from "../support/line-rules"

/** `REASONS` of apps/cli/src/cli/errors.ts at e7b0146, copied: the sentences that must not change. */
const TODAY: Record<string, string> = {
  not_set_up:
    "The runner on that server has not been set up. Run `zekno server add` first.",
  already_set_up:
    "The runner on that server already belongs to a team. It is not overwritten.",
  busy: "The runner is in the middle of another deploy. Try again in a moment.",
  invalid_state:
    "The runner's stored state is damaged or incomplete, so it refuses to act.",
  invalid_request: "The runner could not read the request.",
  code_mismatch:
    "The team code did not match the team list the runner received.",
  unknown_signer:
    "The runner does not know your signing key. Its team list may be out of date.",
  stale_team:
    "The runner is on a different version of the team list than this machine.",
  unknown_server: "That server is not in the team list the runner holds.",
  replayed:
    "The runner has already accepted a deploy with this number or a higher one.",
  secrets_mismatch:
    "The secrets delivered do not match the ones the deploy lists.",
  wrong_team: "The runner on that server belongs to another team.",
  wrong_server: "That deploy was made for a different server.",
  sequence_jump:
    "The deploy number is too far ahead of the last one the runner accepted.",
  bad_signature: "The runner could not verify the signature.",
  role_not_allowed: "Your role in the team does not allow deploys.",
  stale_secret:
    "The deploy carries an older version of a secret than the runner already accepted.",
  too_large:
    "The deploy is larger than the runner accepts, or the server already holds as many apps or secrets as a runner can.",
}

/** R1 to R8 of contracts/cli.md, exactly. */
const R1 =
  "Another deploy of this app reached the runner first. Nothing of this one ran. Run zekno deploy again to deploy on top of it."
const R2 =
  "This deploy was made after a deploy the runner does not hold. Nothing of it ran. Run zekno status to see what the runner holds."
const R3 =
  "The deploy does not account for every secret the runner holds for this app. Nothing of it ran. Run zekno deploy again."
const R4 =
  "The runner does not hold a secret this deploy lists, and it was not sent with it. Nothing of it ran. Run zekno deploy again."
const R5 =
  "A secret of this app was set by someone who is no longer in the team. Nothing of this deploy ran. Set it again with zekno secret set, or remove it with zekno secret rm."
const R6 =
  "The time this deploy had to run had passed by the server's clock. Nothing of it ran. Deploy again, and check the server's clock if it says so again."
const R7 =
  "The runner on that server does not carry out everything this deploy asks for. Nothing of it ran. Run zekno status to compare its version with this zekno's."
const R8 =
  "The runner could not read this deploy. Nothing of it ran. Run zekno status to compare its version with this zekno's."
/** R9 of specs/015-domains-https/design/lines.md, exactly: protocol 4's refusal `domain_taken`. */
const R9 =
  "A domain of this deploy belongs to another app on that server. Nothing of it ran. Run zekno domain to see which."

/**
 * Every reason a `deploy` check can give (research R15): the 15 of version
 * 1, the 3 new, protocol 4's `domain_taken`, protocol 6's `pack_missing` and
 * `pack_mismatch`, and the 8 of every request, protocol 6's `low_disk`,
 * `docker_too_old` and `no_build_plugin` among them.
 */
const EVERY = [...DEPLOY_REFUSALS, ...DEPLOY_V2_REFUSALS, ...RUNNER_REFUSALS]

/**
 * Protocol 6's refusals and the row of specs/016-build-from-source/design/
 * lines.md each says (contracts/cli.md CL7, "The answer"): R11 to R14, and
 * for `pack_missing` D20, the line of pieces still missing once the rounds
 * of CL7 step 12 are spent (a rollback says G43 or G44, tasks T134). Until
 * the words tasks, the id is the text said.
 */
const BUILDING: Record<string, string> = {
  pack_mismatch: "R11",
  docker_too_old: "R12",
  no_build_plugin: "R13",
  low_disk: "R14",
  pack_missing: "D20",
}

/** What a refusal of a version-2 deploy says, reason by reason. */
const VERSION_TWO: Record<string, string> = {
  ...TODAY,
  replayed: R1,
  sequence_jump: R2,
  secrets_mismatch: R3,
  secret_missing: R4,
  untrusted_secret: R5,
  expired: R6,
  unsupported_version: R7,
  malformed: R8,
  wrong_payload_type: R8,
  domain_taken: R9,
  ...BUILDING,
}

/** What a refusal of a version-1 deploy says: today's, with the reasons today said only by their word. */
const VERSION_ONE: Record<string, string> = {
  ...TODAY,
  secret_missing: R4,
  untrusted_secret: R5,
  expired: R6,
  unsupported_version: R7,
  malformed: R8,
  wrong_payload_type: R8,
  domain_taken: R9,
  ...BUILDING,
}

describe("explainDeploy (SC-011)", () => {
  test("29 reasons, each named once", () => {
    expect(EVERY).toHaveLength(29)
    expect(new Set(EVERY).size).toBe(29)
  })

  test("version 2: every reason has its own sentence, R1 to R8 where they apply, never the general one", () => {
    for (const reason of EVERY) {
      const said = explainDeploy(reason, 2)
      expect({ reason, said }).toEqual({ reason, said: VERSION_TWO[reason]! })
      expect(said.startsWith("The runner refused the request")).toBe(false)
    }
  })

  test("version 1: today's sentences for replayed, sequence_jump and secrets_mismatch; R7 and R8 where they apply", () => {
    for (const reason of EVERY) {
      const said = explainDeploy(reason, 1)
      expect({ reason, said }).toEqual({ reason, said: VERSION_ONE[reason]! })
      expect(said.startsWith("The runner refused the request")).toBe(false)
    }
    expect(explainDeploy("replayed", 1)).toBe(TODAY.replayed!)
    expect(explainDeploy("sequence_jump", 1)).toBe(TODAY.sequence_jump!)
    expect(explainDeploy("secrets_mismatch", 1)).toBe(TODAY.secrets_mismatch!)
  })

  test("a reason no list names: the general sentence, with its word", () => {
    expect(explainDeploy("not_admin", 2)).toBe(
      "The runner refused the request (not_admin)."
    )
    expect(explainDeploy("not_admin", 1)).toBe(
      "The runner refused the request (not_admin)."
    )
  })

  test("R1 to R9: the first sentence fits one line, no em dash, no agent", () => {
    for (const line of [R1, R2, R3, R4, R5, R6, R7, R8, R9]) {
      fitsOneLine(line)
      keepsTheHabits(line)
    }
  })
})

describe("explain and RunnerRefused, as before", () => {
  test("explain gives today's sentence for each of today's reasons", () => {
    for (const [reason, sentence] of Object.entries(TODAY))
      expect({ reason, said: explain(reason) }).toEqual({
        reason,
        said: sentence,
      })
    expect(explain("not_admin")).toBe(
      "The runner refused the request (not_admin)."
    )
  })

  test("explain gives R4 to R6 for the three new reasons, which no version-1 answer carries", () => {
    expect(explain("secret_missing")).toBe(R4)
    expect(explain("untrusted_secret")).toBe(R5)
    expect(explain("expired")).toBe(R6)
  })

  test("explain gives protocol 6's five refusals their row's id, to any request: `pack` is refused low_disk or pack_mismatch too (CO10)", () => {
    for (const [reason, id] of Object.entries(BUILDING))
      expect({ reason, said: explain(reason) }).toEqual({ reason, said: id })
    expect(new RunnerRefused("low_disk").message).toBe("R14")
  })

  test("RunnerRefused keeps its reason; its sentence is explain's unless one is given", () => {
    const given = new RunnerRefused("busy", "x")
    expect(given.reason).toBe("busy")
    expect(given.message).toBe("x")
    const plain = new RunnerRefused("busy")
    expect(plain.reason).toBe("busy")
    expect(plain.message).toBe(TODAY.busy!)
  })
})
