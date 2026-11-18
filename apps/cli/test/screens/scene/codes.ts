/**
 * The rules for the values a run of the program makes afresh each time, and
 * that the stand-ins cannot fix: the codes made from keys created during the
 * run, how long a deploy took, and the runner's size, which the stand-in
 * release makes far smaller than a real one.
 */
import type { Rule } from "./rules"

/** A team or server code: five groups of four, from the alphabet of packages/core/src/crypto/confirm.ts. */
const CODE = /\b[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}\b/g

/** The team code, the first code a run from nothing shows. */
export const TEAM_CODE: Rule = {
  pattern: CODE,
  shown: "7KQ2-M4XD-9WTA-3HPE-R8NC",
  what: "the team code, made from a key created on each run",
  once: true,
}

/** The server code, the code of the runner's key, which the runner makes when it is set up. */
export const SERVER_CODE: Rule = {
  pattern: CODE,
  shown: "C5VJ-2PRX-8DQM-K7TW-4NHA",
  what: "the server code, made from the key the runner creates on each run",
  once: true,
}

/**
 * The runner's size. The stand-in release is a short script, so the program
 * says `1 MB`; apps/runner/README.md says the runner file is about 110 MB.
 */
export const RUNNER_SIZE: Rule = {
  pattern: /\b\d+ MB, checksum verified/g,
  shown: "110 MB, checksum verified",
  what: "the runner's size: the stand-in release is a small script; 110 MB is the size apps/runner/README.md gives for the runner file",
}

/** How long a deploy took, read from the clock. */
export const DEPLOY_TIME: Rule = {
  pattern: /\bin \d+\.\ds\b/g,
  shown: "in 4.2s",
  what: "how long the deploy took, read from the clock",
}
