/**
 * `zekno domain add <domain> [--service <name>] [--yes]` and `zekno domain rm
 * <domain> [--yes]` (specs/015-domains-https, contracts/cli.md, CL2; board
 * `DomainsAdd`): what they show and ask. They follow `zekno settings set`:
 * the change line (A1, A2, A8), the question (A3) unless `--yes`, the write,
 * `✔ Written` (A4, A9); then, after a domain is added, the record to create
 * (A5) or what to point at the server (A6). What they do is in
 * ops/domain.ts; their words in domains/words.ts.
 *
 * With no terminal: the change line and the result as `zekno settings set`
 * prints them, then A5 as `record<TAB>A<TAB>shop.example.com<TAB>203.0.113.7`,
 * or nothing for A6. `--json`: one object, the change and the record when
 * known, and nothing else on standard output.
 */
import type { Deps } from "../cli/context"
import { Left, WrongInput } from "../cli/errors"
import {
  A16,
  A4,
  A5,
  A6,
  A7,
  A7_COLLAPSED,
  A9,
  recordPlain,
} from "../domains/words"
import {
  domainChange,
  prepareAdd,
  prepareRemove,
  recordFor,
  serviceFor,
  type DomainPlan,
} from "../ops/domain"
import { writeSettingChange } from "../ops/settings"
import { SETTINGS_FILE } from "../settings/file"
import { CS10, CS11_TO, CS9, IN6 } from "../settings/words"
import { plainCell, strong } from "../ui/types"

type Options = { yes: boolean; json: boolean }

/** What `--json` prints: the service, its domains before and after, and the record to create when it is known. */
type DomainJson = {
  service: string
  domains: { now: readonly string[]; next: readonly string[] }
  record?: { type: string; name: string; value: string }
}

/**
 * A5 or A6 (board `DomainsAdd`): at a terminal, after an empty line, A5's
 * first sentence dim and set in by two columns, then the record, the domain
 * and the address bold; or A6, dim and set in. Plain output prints only the
 * record, as a script reads it, and nothing for A6 (CL2). Only a terminal
 * asks (`Ui.asks`), as `zekno add` tells the two apart for IN6.
 */
function sayRecord(
  deps: Deps,
  domain: string,
  found: Awaited<ReturnType<typeof recordFor>>
): void {
  const atTerminal = deps.ui.asks
  deps.ui.gap()
  if ("record" in found) {
    const { type, address } = found.record
    if (atTerminal) deps.ui.note(A5.first)
    deps.ui.line(recordPlain(type, domain, address), [
      plainCell(`  ${type}  `),
      { ...strong(domain), tight: true },
      { ...plainCell("  "), tight: true },
      { ...strong(address), tight: true },
    ])
    return
  }
  if (atTerminal) deps.ui.note(A6(domain, found.server))
}

/** The change line, the question, the write and the result: as `zekno settings set` says them, then the record after an `add`. */
async function write(
  deps: Deps,
  plan: DomainPlan,
  verb: "add" | "rm",
  options: Options
): Promise<number> {
  const { change } = plan
  if (!options.json)
    deps.ui.settingChange({
      service: plan.service,
      label: change.label,
      now: change.now,
      next: change.next,
    })
  const file = plan.read.shown
  if (!options.yes && !(await deps.ui.confirm(CS9(file), CS10(file))))
    throw new Left()
  writeSettingChange(plan)
  const found = verb === "add" ? await recordFor(deps) : undefined
  if (options.json) {
    const shown: DomainJson = {
      service: plan.service,
      domains: { now: plan.now, next: plan.next },
    }
    if (found !== undefined && "record" in found)
      shown.record = {
        type: found.record.type,
        name: plan.domain,
        value: found.record.address,
      }
    deps.ui.json(shown)
    // Said apart from the object, on standard error, as `zekno settings --json` says it.
    if (plan.both) deps.ui.warn(IN6)
    return 0
  }
  // A file other than this folder's own is named, as `zekno settings set` names it (security review S7).
  const words = verb === "add" ? A4 : A9
  deps.ui.success(
    file === SETTINGS_FILE ? words.text : CS11_TO(file),
    words.detail
  )
  if (found !== undefined) sayRecord(deps, plan.domain, found)
  if (plan.both) deps.ui.warn(IN6)
  return 0
}

/** `zekno domain add <domain> [--service <name>] [--yes]`: adds the domain to a service of the file a deploy here would sign. */
export async function domainAdd(
  deps: Deps,
  typed: string | undefined,
  options: Options & { service?: string }
): Promise<number> {
  const { domain, file } = prepareAdd(deps, typed)
  const found = serviceFor(file.read.settings, file.read.shown, options.service)
  // A7: several services have a port. With no terminal, A16, status 2.
  const service =
    "service" in found
      ? found.service
      : await deps.ui.choose({
          question: A7(domain),
          rows: found.ask.map((name) => ({ value: name, label: name })),
          collapsed: A7_COLLAPSED,
          missing: new WrongInput(A16),
        })
  return write(deps, domainChange(file, service, domain, "add"), "add", options)
}

/** `zekno domain rm <domain> [--yes]`: takes the domain out of the service that has it. The next deploy releases it. */
export async function domainRemove(
  deps: Deps,
  typed: string | undefined,
  options: Options
): Promise<number> {
  return write(deps, prepareRemove(deps, typed), "rm", options)
}
