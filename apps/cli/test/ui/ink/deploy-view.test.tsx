/**
 * The terminal's deploy block with a domain or a health check
 * (specs/015-domains-https, contracts/cli.md, CL3; boards `DomainsDeploy`,
 * `DomainsDns`, `DomainsHealth`; tasks T057, T058), as words: B4 while the
 * new domains are waited for, B5 and B6 between the result and what to run
 * next, and `routes_failed` or `unhealthy` with `✔ Started` and its sentence
 * after `✖`, with no "Number N is used". The panel's `domains` row, the
 * fifth stage and the colours are the screens' phase.
 */
import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"

import { B16, B6, C3 } from "../../../src/domains/words"
import type { DeployProgress } from "../../../src/shared/deploy"
import { DeployBlock, type DeployShown } from "../../../src/ui/ink/deploy-view"
import { withoutBackticks } from "../../../src/ui/ink/marks"

const DEPLOY: DeployProgress = {
  server: "prod-1",
  app: "shop",
  sequence: 43,
  secrets: 2,
  format: 2,
  stage: "started",
  lines: [],
  running: false,
  since: 0,
  domains: ["shop.example.com"],
}

const draw = (shown: DeployShown) =>
  renderToString(<DeployBlock shown={shown} columns={100} />, {
    columns: 100,
  })
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)

const START = { app: "shop", server: "prod-1", flags: "" }

describe("the deploy block with domains (CL3)", () => {
  test("while new domains are waited for: started, the result, B4; then B5 and B6 before what to run next", () => {
    const waiting = draw({
      start: START,
      deploy: {
        ...DEPLOY,
        running: true,
        https: [
          { domain: "shop.example.com", state: "waiting", since: Date.now() },
        ],
      },
      dropped: 0,
      ms: 4200,
    })
    expect(waiting).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
    expect(waiting.slice(-2)[0]).toBe("✔ shop is live on prod-1 in 4.2s")
    expect(waiting.at(-1)).toMatch(
      /^. Waiting for the certificate of shop\.example\.com {2}\d+s$/
    )
    const ended = draw({
      start: START,
      deploy: {
        ...DEPLOY,
        outcome: "started",
        https: [
          {
            domain: "shop.example.com",
            state: "live",
            until: new Date("2027-02-17T12:00:00Z"),
          },
          { domain: "www.example.com", state: "not_ready" },
        ],
      },
      dropped: 0,
      ms: 4200,
    })
    expect(ended.slice(-4)).toEqual([
      "✔ shop is live on prod-1 in 4.2s",
      "✔ https://shop.example.com is live  certificate until 17 Feb 2027",
      `! ${withoutBackticks(B6("www.example.com"))}`,
      "  zekno logs to watch it, zekno rollback to undo",
    ])
  })

  test("routes_failed and unhealthy: ✔ Started, the sentence after ✖, no number said", () => {
    for (const [outcome, problem] of [
      ["routes_failed", B16("shop", "prod-1", 80)],
      ["unhealthy", C3("web", "/health", 60, "shop")],
    ] as const) {
      const lines = draw({
        start: START,
        deploy: { ...DEPLOY, outcome },
        dropped: 0,
        ms: 4200,
        problem,
      })
      expect(lines).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
      expect(lines.some((line) => line.includes("Number"))).toBe(false)
      expect(lines.some((line) => line.includes("is live"))).toBe(false)
      const first = withoutBackticks(problem).split(". ")[0]!
      expect(lines.find((line) => line.startsWith("✖ "))).toStartWith(
        `✖ ${first}`
      )
    }
  })
})
