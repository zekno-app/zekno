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
import {
  failedSentence,
  plainDeployView,
  startedSentence,
} from "../../src/shared/deploy"
import { stoppedWaitingPlain } from "../../src/shared/start-limit"
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

  test("start_failed with startLimit: B20 on standard error in place of today's line, then Docker's lines; without it, today's line (lead A10)", async () => {
    /** The plain view, with the server's lines kept on standard error beside zekno's own. */
    const view = (say: boolean) => {
      const out: string[] = []
      const err: string[] = []
      const ui = plainUi(
        (line) => out.push(line),
        (line) => err.push(line),
        (text) => void err.push(text.trimEnd())
      )
      return { out, err, view: plainDeployView(ui, say) }
    }
    const stopped = view(true)
    stopped.view.progress(" Container shop-db-1  Waiting")
    await stopped.view.end({
      outcome: "start_failed",
      ...ENDING,
      startLimit: 1800,
    })
    expect({ out: stopped.out, err: stopped.err }).toEqual({
      out: [],
      err: [
        stoppedWaitingPlain("prod-1", 43, "shop", 1800),
        "remote:  Container shop-db-1  Waiting",
      ],
    })

    const failed = view(true)
    await failed.view.end({ outcome: "start_failed", ...ENDING })
    expect(failed.err).toEqual([failedSentence(ENDING)])
    expect(failedSentence(ENDING)).toBe(
      "Deploy 43 of shop was accepted by prod-1, but the app did not start. Check Docker on the server."
    )

    // With --json the sentence is not said; Docker's lines still go to standard error.
    const json = view(false)
    json.view.progress(" Container shop-db-1  Waiting")
    await json.view.end({
      outcome: "start_failed",
      ...ENDING,
      startLimit: 1800,
    })
    expect(json.err).toEqual(["remote:  Container shop-db-1  Waiting"])
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
