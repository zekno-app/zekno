/**
 * Feature 015's deploy lines at a terminal, in colour, against the approved
 * boards (specs/015-domains-https, design/lines.md, parts B and C; boards
 * `DomainsDeploy`, `DomainsDns`, `DomainsHealth`; tasks T069 to T071, T075):
 * each drawn as a terminal that shows every colour receives it, and read back
 * as runs of characters in one look, the spaces between words left out. A
 * mark is never colour alone; a detail is dim; a first sentence is bold. A
 * deploy with no domain and no health check draws its four stages as before.
 * The lines of `zekno domain`, `zekno doctor` and `zekno domain add` are
 * domains-terminal-lists.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { B1, B16, B6, C3 } from "../../../src/domains/words"
import type { DeployProgress } from "../../../src/shared/deploy"
import type { DeployShown } from "../../../src/ui/ink/deploy-view"
import { withoutBackticks } from "../../../src/ui/ink/marks"
import { asDate, drawnInColour, wordRuns } from "../../support/colour"
import {
  bold,
  BRAND,
  dim,
  line,
  look,
  plain,
  runsAt,
  SRC,
  textOf,
} from "./domains-colour"

const START = { app: "shop", server: "prod-1", flags: "" }

/** Deploy 43 of shop on prod-1, with shop.example.com, as the boards draw it. */
const DEPLOY: DeployProgress = {
  server: "prod-1",
  app: "shop",
  sequence: 43,
  secrets: 2,
  format: 2,
  stage: "started",
  lines: [],
  running: false,
  outcome: "started",
  since: 0,
  domains: ["shop.example.com"],
}

/** The health check of the board `DomainsHealth`: web, GET /health, within 60s. */
const HEALTH = { timeout: 60, services: [{ service: "web", path: "/health" }] }

/** The terminal's deploy block, 100 columns wide, in colour. */
const block = (deploy: DeployProgress, extra: Partial<DeployShown> = {}) =>
  drawnInColour(
    join(SRC, "ui/ink/deploy-view.tsx"),
    "DeployBlock",
    {
      shown: { start: START, deploy, dropped: 0, ms: 4200, ...extra },
      columns: 100,
    },
    100
  )

/** The four stages a deploy that started draws, done. */
const FOUR_DONE = ["Checked", "Signed", "Sent", "Started"].flatMap((label) => [
  look("✔", { color: "green" }),
  plain(label),
])
describe("zekno deploy with a domain (board DomainsDeploy)", () => {
  test("B1 before the panel: the mark green, the words, the address dim", () => {
    const said = B1("shop.example.com", "prod-1", "203.0.113.7")
    const drawn = line({
      kind: "success",
      text: said.text,
      detail: said.detail,
    })
    expect(textOf(drawn)).toEqual([
      "✔ shop.example.com points to prod-1  203.0.113.7",
    ])
    expect(wordRuns(drawn.split("\n")[0]!)).toEqual([
      look("✔", { color: "green" }),
      plain("shop.example.com points to prod-1"),
      dim("203.0.113.7"),
    ])
  })

  test("the panel's domains row after secrets, the label dim; the result, B5 and what to run next", () => {
    const drawn = block({
      ...DEPLOY,
      https: [
        {
          domain: "shop.example.com",
          state: "live",
          until: asDate("2027-02-17T12:00:00Z"),
        },
      ],
    })
    expect(textOf(drawn)).toEqual([
      "╭─ Deploy 43 ──────────────────────────────────────────────────╮",
      "│ app       shop                                               │",
      "│ server    prod-1                                             │",
      "│ secrets   2                                                  │",
      "│ domains   shop.example.com                                   │",
      "╰──────────────────────────────────────────────────────────────╯",
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started",
      "✔ shop is live on prod-1 in 4.2s",
      "✔ https://shop.example.com is live  certificate until 17 Feb 2027",
      "  zekno logs to watch it, zekno rollback to undo",
    ])
    expect(runsAt(drawn, "domains")).toEqual([
      dim("│"),
      dim("domains"),
      plain("shop.example.com"),
      dim("│"),
    ])
    expect(runsAt(drawn, "Checked")).toEqual(FOUR_DONE)
    expect(runsAt(drawn, "https://")).toEqual([
      look("✔", { color: "green" }),
      plain("https://shop.example.com is live"),
      dim("certificate until 17 Feb 2027"),
    ])
    expect(runsAt(drawn, "zekno logs")).toEqual([
      dim("zekno logs to watch it, zekno rollback to undo"),
    ])
  })

  test("waiting for the certificate: started, the result, B4 with the stage row's spinner and the seconds dim", () => {
    const drawn = block({
      ...DEPLOY,
      running: true,
      outcome: undefined,
      https: [
        { domain: "shop.example.com", state: "waiting", since: Date.now() },
      ],
    })
    const words = textOf(drawn)
    expect(words.slice(-3)).toEqual([
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started",
      "✔ shop is live on prod-1 in 4.2s",
      expect.stringMatching(
        /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Waiting for the certificate of shop\.example\.com {2}\d+s$/
      ),
    ])
    const [spinner, ...rest] = runsAt(drawn, "Waiting")
    expect(spinner).toMatchObject({ bold: false, dim: false, color: BRAND })
    expect(rest).toEqual([
      plain("Waiting for the certificate of shop.example.com"),
      dim(expect.stringMatching(/^\d+s$/) as unknown as string),
    ])
    expect(runsAt(drawn, "is live")).toEqual([
      look("✔", { color: "green" }),
      bold("shop is live on prod-1"),
      dim("in 4.2s"),
    ])
  })

  test("not ready in time: B6 after a yellow !, its command without backticks, before what to run next", () => {
    const drawn = block({
      ...DEPLOY,
      https: [{ domain: "shop.example.com", state: "not_ready" }],
    })
    expect(textOf(drawn).slice(-2)).toEqual([
      `! ${withoutBackticks(B6("shop.example.com"))}`,
      "  zekno logs to watch it, zekno rollback to undo",
    ])
    expect(runsAt(drawn, "not ready yet")).toEqual([
      look("!", { color: "yellow" }),
      plain(withoutBackticks(B6("shop.example.com"))),
    ])
  })

  test("later deploys: a row a domain, labelled once; past three, the first three and `and 5 more` dim", () => {
    const two = block({
      ...DEPLOY,
      domains: ["shop.example.com", "www.example.com"],
    })
    expect(textOf(two).slice(3, 6)).toEqual([
      "│ secrets   2                                                  │",
      "│ domains   shop.example.com                                   │",
      "│           www.example.com                                    │",
    ])
    const eight = block({
      ...DEPLOY,
      domains: Array.from({ length: 8 }, (_, at) => `d${at}.example.com`),
    })
    expect(textOf(eight).slice(4, 9)).toEqual([
      "│ domains   d0.example.com                                     │",
      "│           d1.example.com                                     │",
      "│           d2.example.com                                     │",
      "│           and 5 more                                         │",
      "╰──────────────────────────────────────────────────────────────╯",
    ])
    expect(runsAt(eight, "and 5 more")).toEqual([
      dim("│"),
      dim("and 5 more"),
      dim("│"),
    ])
  })

  test("no domain and no health check: the panel and the four stages as before", () => {
    const drawn = block({ ...DEPLOY, domains: undefined })
    expect(textOf(drawn).slice(0, 6)).toEqual([
      "╭─ Deploy 43 ──────────────────────────────────────────────────╮",
      "│ app       shop                                               │",
      "│ server    prod-1                                             │",
      "│ secrets   2                                                  │",
      "╰──────────────────────────────────────────────────────────────╯",
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started",
    ])
    expect(runsAt(drawn, "Checked")).toEqual(FOUR_DONE)
  })
})

describe("a health check (board DomainsHealth)", () => {
  const healthy = { ...DEPLOY, health: HEALTH }

  test("waiting: ✔ Started, the fifth stage with the spinner, bold; C2 under it, dim, with the seconds", () => {
    const drawn = block({
      ...healthy,
      stage: "starting",
      running: true,
      outcome: undefined,
      waitingFor: { service: "web", path: "/health", since: Date.now() },
    })
    const words = textOf(drawn)
    expect(words.at(-2)).toMatch(
      /^✔ Checked {2}✔ Signed {2}✔ Sent {2}✔ Started {2}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Healthy$/
    )
    expect(words.at(-1)).toMatch(
      /^ {2}waiting for web to answer GET \/health {2}\d+s$/
    )
    const stages = runsAt(drawn, "Healthy")
    expect(stages.slice(0, 8)).toEqual(FOUR_DONE)
    expect(stages[8]).toMatchObject({ bold: true, color: BRAND })
    expect(stages[9]).toEqual(bold("Healthy"))
    // The words and the seconds in one look, dim.
    expect(runsAt(drawn, "waiting for")).toEqual([
      dim(
        expect.stringMatching(
          /^waiting for web to answer GET \/health {2}\d+s$/
        ) as unknown as string
      ),
    ])
  })

  test("before the runner waits: Starting in progress and ○ Healthy dim; Docker's line stays", () => {
    const drawn = block({
      ...healthy,
      stage: "starting",
      running: true,
      outcome: undefined,
      lines: ["web  | listening on 3000"],
    })
    expect(textOf(drawn).slice(-2)).toEqual([
      expect.stringMatching(
        /^✔ Checked {2}✔ Signed {2}✔ Sent {2}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Starting {2}○ Healthy$/
      ),
      "  web  | listening on 3000",
    ])
    expect(runsAt(drawn, "Healthy").at(-1)).toEqual(dim("○ Healthy"))
  })

  test("healthy: five stages done, the result and what to run next", () => {
    const drawn = block(healthy, { ms: 9400 })
    expect(textOf(drawn).slice(-3)).toEqual([
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ✔ Healthy",
      "✔ shop is live on prod-1 in 9.4s",
      "  zekno logs to watch it, zekno rollback to undo",
    ])
    expect(runsAt(drawn, "Healthy")).toEqual([
      ...FOUR_DONE,
      look("✔", { color: "green" }),
      plain("Healthy"),
    ])
  })

  test("not healthy in time: ✖ Healthy in red; C3 after ✖, its first sentence bold, the rest dim; nothing said of a number", () => {
    const problem = C3("web", "/health", 60, "shop")
    const drawn = block({ ...healthy, outcome: "unhealthy" }, { problem })
    expect(textOf(drawn).slice(-4)).toEqual([
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ✖ Healthy",
      "✖ web did not answer GET /health with success within 60 seconds.",
      "  shop is running as deployed, and nothing was rolled back. Run zekno logs to see why, or zekno",
      "  rollback to go back.",
    ])
    expect(runsAt(drawn, "Healthy")).toEqual([
      ...FOUR_DONE,
      look("✖ Healthy", { color: "red" }),
    ])
    expect(runsAt(drawn, "did not answer")).toEqual([
      look("✖", { color: "red" }),
      bold("web did not answer GET /health with success within 60 seconds."),
    ])
    expect(runsAt(drawn, "nothing was rolled back")).toEqual([
      dim(
        "shop is running as deployed, and nothing was rolled back. Run zekno logs to see why, or zekno"
      ),
    ])
  })
})

describe("after the deploy was accepted (board DomainsDns)", () => {
  test("routes_failed: ✔ Started, then B16 after ✖, the first sentence bold, the rest dim; no line of what to run next", () => {
    const problem = B16("shop", "prod-1", 80)
    const drawn = block({ ...DEPLOY, outcome: "routes_failed" }, { problem })
    expect(textOf(drawn).slice(-3)).toEqual([
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started",
      "✖ shop is running, but prod-1 cannot answer for its domains: port 80 is in use by another program.",
      "  Free ports 80 and 443 on prod-1, then run zekno deploy again.",
    ])
    expect(runsAt(drawn, "cannot answer")).toEqual([
      look("✖", { color: "red" }),
      bold(
        "shop is running, but prod-1 cannot answer for its domains: port 80 is in use by another program."
      ),
    ])
    expect(runsAt(drawn, "Free ports")).toEqual([
      dim("Free ports 80 and 443 on prod-1, then run zekno deploy again."),
    ])
    // With a health check, routes_failed says nothing of it: Healthy not reached.
    const checked = block(
      { ...DEPLOY, health: HEALTH, outcome: "routes_failed" },
      { problem }
    )
    expect(runsAt(checked, "Healthy").at(-1)).toEqual(dim("○ Healthy"))
  })
})
