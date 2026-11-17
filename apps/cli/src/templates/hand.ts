/**
 * The lines a person adds to a Compose file they wrote by hand
 * (specs/012-templates, contracts/commands.md, "A hand-written Compose file";
 * research R10; board `AddOther`, left column; plan.md, D1, D17, D25). Zekno
 * never edits that file and never reads it: these lines are printed for the
 * person to put in it, and the secrets they name are made and stored only
 * after the person agrees (ops/add-commit.ts, `commitHand`).
 *
 * The form is Compose's short syntax, as a person writes it: under
 * `services:`, two spaces, each service's name and `:`; then `image` (whole,
 * with its digest), `command` (a start command), `restart`, `mem_limit` and
 * `cpus` (a template's limits, the very lines `composeText` writes, so the
 * service pasted is limited as the one added to a settings file);
 * `environment:` with the plain values, then each secret; `volumes:` with
 * `- <vol>:<path>`, each volume named `<service>-<volume>` as adding to a
 * settings file names it (D1). A key with nothing to say is left out. The
 * port is not written, as the board draws the lines: `expose` changes
 * nothing between the services of one Compose project, and a template
 * publishes no port (TF24). The connection secrets' lines go in the
 * `environment:` of each service that uses them, six spaces in.
 *
 * What keeps the lines safe to paste (research R10):
 *
 * - A name or a value is written bare, as the board writes `app` and
 *   `always`, only when it starts with a letter, holds only letters, digits
 *   and `._/:@-`, does not end with `:` (YAML would read a key), and is not
 *   one of YAML 1.1's words for true, false or null; anything else is written
 *   by `quote`, as `composeText` writes a string: `\` and `"` escaped and
 *   every `$` written `$$`, which Compose reads as one literal `$`. So no
 *   value can ask Compose for a variable, end its scalar, start a comment or
 *   be read as another type.
 * - A start command is a flow list of `quote`d words, the very line
 *   `composeText` writes. Redis's keeps `$$REDIS_PASSWORD` for the
 *   container's shell: written with one `$`, Compose would put the password
 *   on the command line of `sh` (research R10, probed).
 * - The one place the lines ask Compose for a variable is a secret,
 *   `<NAME>: ${<NAME>}`, its name held to the secret-name rule. No value of
 *   a secret is ever in a line.
 */
import { limitLines, quote } from "../settings/compose"
import { splitStart } from "../settings/values"
import { servicesInApp } from "./addition"
import type { HandLines, Template } from "./types"

/** What a bare name or value may be: a letter, then letters, digits and `._/:@-`. */
const BARE = /^[A-Za-z][A-Za-z0-9._/:@-]*$/

/** YAML 1.1's words for true, false and null, in any case: never bare. */
const YAML_WORDS = /^(?:y|yes|n|no|on|off|true|false|null)$/i

/** A name or a value as the lines write it: bare when the rule above allows it, else as `composeText` writes a string. */
const scalar = (text: string): string =>
  BARE.test(text) && !YAML_WORDS.test(text) && !text.endsWith(":")
    ? text
    : quote(text)

/** A secret's line: `<NAME>: ${<NAME>}`, `indent` spaces in. The name passed the secret-name rule. */
const secretLine = (indent: number, name: string): string =>
  `${" ".repeat(indent)}${scalar(name)}: \${${name}}`

/**
 * The lines for adding `template` to a Compose file written by hand, its
 * first service named `service` (`--name`, or its own when undefined), for
 * the file `file` as a sentence names it: the services' lines, the volumes
 * to name under `volumes:`, and each connection secret's line.
 */
export function handLines(
  template: Template,
  service: string | undefined,
  file: string
): HandLines {
  const lines: string[] = []
  const volumes: string[] = []
  for (const [name, each] of servicesInApp(template, service)) {
    lines.push(`  ${scalar(name)}:`, `    image: ${scalar(each.image)}`)
    if (each.start !== undefined) {
      const split = splitStart(each.start)
      // A template's services were checked by the settings rules; a start command that does not split is a fault of this program.
      if ("problem" in split)
        throw new Error("A start command that does not split was given.")
      lines.push(`    command: [${split.words.map(quote).join(", ")}]`)
    }
    if (each.restart !== undefined)
      lines.push(`    restart: ${scalar(each.restart)}`)
    lines.push(...limitLines(each))
    const plain = each.plain ?? []
    const secrets = each.secrets ?? []
    if (plain.length + secrets.length > 0) {
      lines.push("    environment:")
      for (const [variable, value] of plain)
        lines.push(`      ${scalar(variable)}: ${scalar(value)}`)
      for (const secret of secrets) lines.push(secretLine(6, secret))
    }
    const mounts = each.volumes ?? []
    if (mounts.length > 0) {
      lines.push("    volumes:")
      for (const [volume, path] of mounts) {
        lines.push(`      - ${scalar(`${volume}:${path}`)}`)
        volumes.push(volume)
      }
    }
  }
  return {
    file,
    service: lines,
    volumes,
    offers: template.offers.map((offer) => secretLine(6, offer.name)),
  }
}
