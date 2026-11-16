/**
 * The form zekno writes a settings file in (specs/010-app-settings,
 * contracts/settings-file.md, "How zekno writes it"; research R5): JSON with
 * two spaces of indent, the keys in a fixed order, services, plain variables
 * and volumes in the file's order, a section, a list or an object with
 * nothing in it left out, and one line feed at the end. An object or a list
 * is written on one line when that line, with its indent, its key and a
 * comma after it, is at most 80 characters; the file, `services` and each
 * service always open on their own line. So a change of one value changes
 * one line, and design.md's example is written back byte for byte.
 */
import type { ServiceSettings, Settings } from "./types"

/** What is written: a value as its JSON text, a list, or an object whose members are in the order given. */
type Node =
  | { kind: "value"; text: string }
  | { kind: "list"; items: Node[] }
  | { kind: "object"; members: [string, Node][]; open?: boolean }

/** The widest line written on one line, in characters. */
const WIDTH = 80

const string = (text: string): Node => ({
  kind: "value",
  text: JSON.stringify(text),
})
const number = (text: string): Node => ({ kind: "value", text })

/** The members that are set. */
const setOnly = (members: [string, Node | undefined][]): [string, Node][] =>
  members.filter((member): member is [string, Node] => Boolean(member[1]))

/** An object of the members that are set, or undefined when none is: a section with nothing in it is left out. */
function object(members: [string, Node | undefined][]): Node | undefined {
  const set = setOnly(members)
  return set.length === 0 ? undefined : { kind: "object", members: set }
}

/** One service's sections, in the order of contracts/settings-file.md, "The settings". */
function serviceNode(service: ServiceSettings): Node {
  const has = <T>(value: T | undefined, node: (value: T) => Node) =>
    value === undefined ? undefined : node(value)
  const sections = setOnly([
    ["source", object([["image", string(service.image)]])],
    [
      "deploy",
      object([
        ["start", has(service.start, string)],
        ["restart", has(service.restart, string)],
        ["memory", has(service.memory, string)],
        ["cpus", has(service.cpus, number)],
      ]),
    ],
    [
      "networking",
      object([
        ["port", has(service.port, (port) => number(String(port)))],
        ["publish", has(service.publish, (port) => number(String(port)))],
      ]),
    ],
    [
      "variables",
      object([
        [
          "secrets",
          service.secrets?.length
            ? { kind: "list", items: service.secrets.map(string) }
            : undefined,
        ],
        [
          "plain",
          object(
            (service.plain ?? []).map(([name, value]) => [name, string(value)])
          ),
        ],
      ]),
    ],
    [
      "volumes",
      object(
        (service.volumes ?? []).map(([name, path]) => [name, string(path)])
      ),
    ],
  ])
  return { kind: "object", members: sections, open: true }
}

/** A node on one line: `{ "a": 1, "b": 2 }`, `["a", "b"]`. */
function flat(node: Node): string {
  if (node.kind === "value") return node.text
  if (node.kind === "list") return `[${node.items.map(flat).join(", ")}]`
  const members = node.members.map(
    ([key, value]) => `${JSON.stringify(key)}: ${flat(value)}`
  )
  return `{ ${members.join(", ")} }`
}

/** Characters as a person counts them in a line. */
const width = (line: string): number => [...line].length

/** Writes `node` after `indent` spaces and `key` (`"name": ` or nothing), with `comma` after it. */
function write(
  node: Node,
  indent: number,
  key: string,
  comma: string,
  out: string[]
): void {
  const pad = " ".repeat(indent)
  if (node.kind === "value") {
    out.push(`${pad}${key}${node.text}${comma}`)
    return
  }
  const one = `${pad}${key}${flat(node)}`
  if (!(node.kind === "object" && node.open) && width(`${one},`) <= WIDTH) {
    out.push(`${one}${comma}`)
    return
  }
  const entries: [string, Node][] =
    node.kind === "list"
      ? node.items.map((item) => ["", item])
      : node.members.map(([name, value]) => [
          `${JSON.stringify(name)}: `,
          value,
        ])
  out.push(`${pad}${key}${node.kind === "list" ? "[" : "{"}`)
  entries.forEach(([inner, value], index) =>
    write(value, indent + 2, inner, index < entries.length - 1 ? "," : "", out)
  )
  out.push(`${pad}${node.kind === "list" ? "]" : "}"}${comma}`)
}

/** The text of a settings file holding `settings`, in zekno's form. */
export function settingsText(settings: Settings): string {
  const file: Node = {
    kind: "object",
    open: true,
    members: [
      ["zekno", number(String(settings.version))],
      [
        "services",
        {
          kind: "object",
          open: true,
          members: settings.services.map(([name, service]) => [
            name,
            serviceNode(service),
          ]),
        },
      ],
    ],
  }
  const out: string[] = []
  write(file, 0, "", "", out)
  return `${out.join("\n")}\n`
}
