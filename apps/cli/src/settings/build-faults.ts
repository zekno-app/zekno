/**
 * What is wrong with a service's build settings, as the settings file is
 * read or as `zekno settings set` is asked (specs/016-build-from-source,
 * contracts/cli.md CL1; tasks T105, T111, T112): a row of design/lines.md
 * (C22 to C29, F5), or, for a rule lines.md has no row for yet, an id of its
 * own. Their sentences wait for rows (T156); until then the text said is the
 * id (FR-092), as `lineText` says a row's.
 *
 * Read from the file, every one is a stop with exit status 1, a fault of the
 * settings file (CL11); refused by `set`, one of its own is exit status 2, as
 * a value `set` refuses (CL1). A fault names a service only once its name
 * passed its rule, and never holds a value of the file.
 */
import { CliError, WrongInput } from "../cli/errors"
import { BuildStop } from "../shared/build-lines"

/** A setting of the Build section or its Source fields, by its name for `set` (CL1, "Keys"). */
export type BuildSettingName =
  | "root"
  | "include"
  | "builder"
  | "dockerfile"
  | "stage"
  | "build-timeout"
  | "build-network"

/**
 * The lines with no row in design/lines.md yet (T156), each by an id of its
 * own:
 *
 * - `needs_build`: `source.root` or `source.include` on a service with no
 *   build, read from the file (data-model.md: "`root` and `include` need
 *   `build`"); at `set`, any setting of the Build section on a service with
 *   no build (T112).
 * - `include_form`: `source.include` is not a list of relative paths inside
 *   the root; `include_too_many`: more than 64; `include_twice`: a path is
 *   there twice.
 * - `builder_unknown`: a builder this zekno does not know, other than
 *   `railpack` (F5); FR-008 says to update zekno.
 * - `builder_missing`: a build with no builder (data-model.md: required with
 *   `build`).
 * - `root_form`: `source.root` is not a relative path with `/` between its
 *   parts (data-model.md), read from the file; at `set` it is G20's form.
 * - `stage_form`: `build.stage` breaks its pattern, read from the file; at
 *   `set` it is G20's form.
 */
export type OwnBuildLine = {
  id:
    | "needs_build"
    | "include_form"
    | "include_too_many"
    | "include_twice"
    | "builder_unknown"
    | "builder_missing"
    | "root_form"
    | "stage_form"
  service: string
  /** For `needs_build`: the setting given to a service with no build. */
  setting?: BuildSettingName
  /** The settings file as zekno shows it, for a fault read from it. */
  file?: string
}

/** The ids of a fault of the Build section that are rows of design/lines.md, with no value beyond the service. */
type RowFaultId = "C23" | "C24" | "C25" | "C26" | "C27" | "C28" | "C29" | "F5"

/** A fault of a service's build settings found by the reader, before the file is named in it. */
export type BuildFault =
  | { id: RowFaultId; service: string }
  /** `repository`: the settings file is in a git repository (C22's two forms). */
  | { id: "C22"; service: string; repository: boolean }
  | Omit<OwnBuildLine, "file">

/** A fault read from the file whose line has no row yet: a stop, exit status 1 (CL11). Its message is its id until T156. */
export class OwnBuildStop extends CliError {
  constructor(readonly line: OwnBuildLine) {
    super(line.id)
  }
}

/** A value `zekno settings set` refuses whose line has no row yet: exit status 2, without the help line, as G20 (CL1, CL11). */
export class OwnBuildRefused extends WrongInput {
  constructor(readonly line: OwnBuildLine) {
    super(line.id)
  }
}

/** The stop a fault of the file `file` (as zekno shows it) ends the run with, exit status 1: its row's, or its own id's. */
export function buildStop(fault: BuildFault, file: string): CliError {
  switch (fault.id) {
    case "C22":
      return new BuildStop({ ...fault, id: fault.id, file })
    case "C23":
    case "C24":
    case "C25":
    case "C26":
    case "C27":
    case "C28":
    case "C29":
    case "F5":
      return new BuildStop({ id: fault.id, file, service: fault.service })
    default:
      return new OwnBuildStop({ ...fault, file })
  }
}
