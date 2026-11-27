/**
 * What this core carries out (specs/016-build-from-source, contracts/core.md
 * CO7; FR-037h, FR-082, FR-083): F7 of the signed deploy's version 2. One
 * table, changed by each release; this library ships inside the runner, as
 * the protocol number does, so no option chooses. Each later lift is a
 * protocol number, never a format change. The table is exported so zekno's
 * tests can pair each row with its protocol threshold (CO7, CL7's F1 to F3).
 */
import { refuse, type Result } from "../protocol/result"
import type { DeployV2 } from "./message"

/** The rows of CO7: what a deploy may ask for that a runner carries out only from some release on. */
export const CARRIED_OUT_ROWS = [
  /** A build whose `builder.name` is `railpack`. */
  "railpack",
  /** A build whose `secrets` is not empty. */
  "build_secrets",
  /** A Railpack build whose `secrets` is not empty, until FR-089a lifts it. */
  "railpack_secrets",
  /** A Railpack build whose `fresh` is the deploy's `sequence`, until check R4 shows it works. */
  "railpack_fresh",
  /** A Railpack build with `network: "none"` (point 18). */
  "railpack_no_network",
  /** A pre-deploy command. */
  "predeploy",
] as const
export type CarriedOutRow = (typeof CARRIED_OUT_ROWS)[number]

export type CarriedOutTable = Readonly<
  Record<CarriedOutRow, { readonly refused: boolean }>
>

/** The table of this release, at step 1's column of CO7: every row refused. */
export const CARRIED_OUT: CarriedOutTable = Object.freeze({
  railpack: Object.freeze({ refused: true }),
  build_secrets: Object.freeze({ refused: true }),
  railpack_secrets: Object.freeze({ refused: true }),
  railpack_fresh: Object.freeze({ refused: true }),
  railpack_no_network: Object.freeze({ refused: true }),
  predeploy: Object.freeze({ refused: true }),
})

/** True when the deploy asks for this row. */
const ASKS: Readonly<Record<CarriedOutRow, (deploy: DeployV2) => boolean>> = {
  railpack: (deploy) =>
    deploy.builds.some((build) => build.builder.name === "railpack"),
  build_secrets: (deploy) =>
    deploy.builds.some((build) => build.secrets.length > 0),
  railpack_secrets: (deploy) =>
    deploy.builds.some(
      (build) => build.builder.name === "railpack" && build.secrets.length > 0
    ),
  railpack_fresh: (deploy) =>
    deploy.builds.some(
      (build) =>
        build.builder.name === "railpack" && build.fresh === deploy.sequence
    ),
  railpack_no_network: (deploy) =>
    deploy.builds.some(
      (build) => build.builder.name === "railpack" && build.network === "none"
    ),
  predeploy: (deploy) => deploy.predeploy !== null,
}

/** Every row of CO7 this deploy asks for, in the table's order. */
export function rowsAskedFor(deploy: DeployV2): CarriedOutRow[] {
  return CARRIED_OUT_ROWS.filter((row) => ASKS[row](deploy))
}

/**
 * F7 (CO7): refuses `unsupported_version` a deploy that asks for a row the
 * table refuses, as one refusal however many rows it asks for. It reads only
 * what F4 to F6 read, so a deploy that breaks a rule is `malformed` first.
 * A Dockerfile build with no secret is carried out, with any network and
 * with `fresh` up to the deploy's own number. `table` is this release's,
 * unless a test gives another.
 */
export function carriedOut(
  read: Result<DeployV2, "malformed">,
  table: CarriedOutTable = CARRIED_OUT
): Result<DeployV2, "malformed" | "unsupported_version"> {
  if (!read.ok) return read
  if (rowsAskedFor(read.value).some((row) => table[row].refused))
    return refuse(
      "unsupported_version",
      "This deploy asks for something this runner does not carry out yet."
    )
  return read
}
