/**
 * Each check of feature 016's Linux checks and where it stands
 * (specs/016-build-from-source, T009; quickstart.md, "Phase 0" and "The
 * jobs"; research/map-checks.md part 7): `record`, which prints what it saw
 * and fails only on its own fault, or `assert`; and its file, or, while it
 * has none, the task that writes it. All record but L18, which asserts from
 * its first run (quickstart.md, phase 0, item 3).
 *
 * A task that writes a check puts its file in place of its own name, on its
 * check's line, and that removes the check's skip line from run-checks.ts. A
 * check with two parts names each part so. Files are paths from the
 * repository's root, of the form FILE_FORM gives.
 */

export const CHECK_IDS = [
  "L1",
  "L2",
  "L3",
  "L4",
  "L4b",
  "L5",
  "L6",
  "L7",
  "L8",
  "L9",
  "L10",
  "L11",
  "L12",
  "L13",
  "L14",
  "L15",
  "L16",
  "L17",
  "L18",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R6",
  "R7",
  "R8",
  "R9",
  "R10",
  "R16",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
] as const
export type CheckId = (typeof CHECK_IDS)[number]

export type Mode = "record" | "assert"

/** The task that writes a check (`T011`), or its file, or its files. */
export type Place = string | readonly string[]

export type Check =
  | { readonly mode: Mode; readonly at: Place }
  | { readonly mode: Mode; readonly parts: Readonly<Record<string, Place>> }

export const MODES: Readonly<Record<CheckId, Check>> = {
  L1: {
    mode: "record",
    at: "apps/runner/test/linux-checks/released-runner.test.ts",
  },
  L2: {
    mode: "record",
    at: "apps/runner/test/linux-checks/syntax-line.test.ts",
  },
  L3: {
    mode: "record",
    at: "apps/runner/test/linux-checks/cache-and-identity.test.ts",
  },
  L4: {
    mode: "record",
    at: "apps/runner/test/linux-checks/cache-and-identity.test.ts",
  },
  L4b: {
    mode: "record",
    at: "apps/runner/test/linux-checks/cache-and-identity.test.ts",
  },
  L5: { mode: "record", at: "apps/runner/test/linux-checks/stopping.test.ts" },
  L6: {
    mode: "record",
    at: "apps/runner/test/linux-checks/memory-and-disk.test.ts",
  },
  L7: {
    mode: "record",
    at: "apps/runner/test/linux-checks/memory-and-disk.test.ts",
  },
  L8: {
    mode: "record",
    at: "apps/runner/test/linux-checks/registry-and-proxies.test.ts",
  },
  L9: {
    mode: "record",
    at: "apps/runner/test/linux-checks/materials-and-records.test.ts",
  },
  L10: {
    mode: "record",
    at: "apps/runner/test/linux-checks/materials-and-records.test.ts",
  },
  L11: { mode: "record", at: "T165" },
  L12: {
    mode: "record",
    at: "apps/runner/test/linux-checks/secrets.test.ts",
  },
  L13: {
    mode: "record",
    at: "apps/runner/test/linux-checks/secrets.test.ts",
  },
  L14: {
    mode: "record",
    at: "apps/runner/test/linux-checks/secrets.test.ts",
  },
  L15: {
    mode: "record",
    at: "apps/runner/test/linux-checks/secret-salts.test.ts",
  },
  L16: {
    mode: "record",
    at: "apps/runner/test/linux-checks/secrets.test.ts",
  },
  L17: { mode: "record", at: "apps/cli/test/linux-checks/file-choice.test.ts" },
  L18: { mode: "assert", at: "apps/runner/test/linux-checks/sandbox.test.ts" },
  R1: { mode: "record", at: "T219" },
  R2: { mode: "record", at: "T217" },
  R3: { mode: "record", at: "T217" },
  R4: { mode: "record", at: "T220" },
  R5: { mode: "record", at: "T219" },
  R6: { mode: "record", at: "T214" },
  R7: { mode: "record", at: "T220" },
  R8: { mode: "record", at: "T220" },
  R9: { mode: "record", at: "T220" },
  R10: { mode: "record", at: "T220" },
  R16: { mode: "record", at: "T218" },
  B1: { mode: "record", parts: { Dockerfile: "T173", Railpack: "T247" } },
  B2: { mode: "record", at: "T166" },
  B3: { mode: "record", parts: { fingerprint: "T166", Railpack: "T247" } },
  B4: { mode: "record", parts: { proof: "T168", ARM64: "T173" } },
  B5: { mode: "record", at: "T171" },
  B6: { mode: "record", at: "T174" },
}

const TASK = /^T\d{3}$/

/** A check's file: under a package's `test/linux-checks/`, or a proof of `apps/cli/test/scenarios/`. */
export const FILE_FORM =
  /^apps\/(?:runner|cli)\/test\/linux-checks\/[a-z0-9-]+\.test\.ts$|^apps\/cli\/test\/scenarios\/linux-proof-[a-z0-9-]+\.test\.ts$/

/** True while a place names the task that will write the check. */
export function isTask(place: Place): place is string {
  return typeof place === "string" && TASK.test(place)
}

/** The files a place names; none for a task. */
export function filesOf(place: Place): readonly string[] {
  if (isTask(place)) return []
  return typeof place === "string" ? [place] : place
}

/** What a skip line or a record line calls a part: `B1 (Dockerfile part)`. */
export function partLabel(id: CheckId, part: string): string {
  return `${id} (${part} part)`
}

export type Unit = { readonly label: string; readonly place: Place }

/**
 * A check as it is run: itself, or each of its parts (only `parts` when
 * given). A part the check does not have throws.
 */
export function unitsOf(
  id: CheckId,
  parts?: readonly string[],
  modes: Readonly<Record<CheckId, Check>> = MODES
): Unit[] {
  const check = modes[id]
  if ("at" in check) {
    if (parts !== undefined) throw new Error(`${id} has no parts`)
    return [{ label: id, place: check.at }]
  }
  const names = parts ?? Object.keys(check.parts)
  return names.map((part) => {
    const place = check.parts[part]
    if (place === undefined) throw new Error(`${id} has no ${part} part`)
    return { label: partLabel(id, part), place }
  })
}

/** Every id and part label a record line may name. */
export function labels(): string[] {
  return CHECK_IDS.flatMap((id) => [
    id,
    ...unitsOf(id)
      .map((unit) => unit.label)
      .filter((label) => label !== id),
  ])
}

/** The line run-checks.ts prints for an id or part that has no file yet. */
export function notWritten(label: string): string {
  return `${label} skipped: not written yet`
}
