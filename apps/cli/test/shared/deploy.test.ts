/**
 * The deploy view of plain output with a domain or a health check
 * (specs/015-domains-https, contracts/cli.md, CL3, "With no terminal"; tasks
 * T056, T057): B1 as `dns<TAB>…` before the result, B5 as `https<TAB>…<TAB>
 * live<TAB>…` and B6 as `https<TAB>…<TAB>waiting` after it, on standard
 * output; `routes_failed` and `unhealthy` their sentence on standard error,
 * in place of the result line; with `--json` none of it.
 */
import { describe, expect, test } from "bun:test"

import {
  B16,
  C4,
  httpsLivePlain,
  httpsWaitingPlain,
} from "../../src/domains/words"
import { plainDeployView, startedSentence } from "../../src/shared/deploy"
import { plainUi } from "../../src/ui/plain/plain"

const ENDING = {
  sequence: 43,
  app: "shop",
  server: "prod-1",
  secrets: 2,
  ms: 4200,
}

function view(say: boolean) {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    view: plainDeployView(
      plainUi(
        (line) => out.push(line),
        (line) => err.push(line)
      ),
      say
    ),
  }
}

describe("the plain deploy view with domains (CL3)", () => {
  test("B1 before, the result, then B5 and B6 in the order of the domains; the wait itself says nothing", async () => {
    const v = view(true)
    v.view.pointed?.("shop.example.com", "203.0.113.7")
    v.view.https?.({ domain: "shop.example.com", state: "waiting", since: 0 })
    await v.view.end({
      outcome: "started",
      ...ENDING,
      https: [
        {
          domain: "shop.example.com",
          state: "live",
          until: new Date("2027-02-17T12:00:00Z"),
        },
        { domain: "www.example.com", state: "not_ready" },
      ],
    })
    expect({ out: v.out, err: v.err }).toEqual({
      out: [
        "dns\tshop.example.com\t203.0.113.7",
        startedSentence(ENDING),
        httpsLivePlain("shop.example.com", new Date("2027-02-17T12:00:00Z")),
        httpsWaitingPlain("www.example.com"),
      ],
      err: [],
    })
    expect(v.out.at(-1)).toBe("https\twww.example.com\twaiting")
  })

  test("routes_failed and unhealthy: their sentence on standard error, no result line", async () => {
    for (const [outcome, problem] of [
      ["routes_failed", B16("shop", "prod-1", 80)],
      ["unhealthy", C4("web", 60, "shop")],
    ] as const) {
      const v = view(true)
      await v.view.end({ outcome, ...ENDING, problem })
      expect({ out: v.out, err: v.err }).toEqual({ out: [], err: [problem] })
    }
  })

  test("with --json, none of it: standard output holds the one object", async () => {
    const v = view(false)
    v.view.pointed?.("shop.example.com", "203.0.113.7")
    await v.view.end({
      outcome: "routes_failed",
      ...ENDING,
      problem: B16("shop", "prod-1", 80),
    })
    expect({ out: v.out, err: v.err }).toEqual({ out: [], err: [] })
  })
})
