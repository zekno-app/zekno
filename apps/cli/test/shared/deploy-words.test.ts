/**
 * What the CLI says itself about a deploy in feature 014 (specs/014-deploy-v2,
 * contracts/cli.md, "Every line"; design/lines.md, part C; tasks T028): each
 * sentence exactly as the maintainer approved it, filled in with the same
 * names everywhere. A refusal's first sentence is drawn bold and fits one
 * line of 100 columns beside its mark, so it is at most 98 characters.
 */
import { describe, expect, test } from "bun:test"

import {
  blockedLines,
  C1,
  C2,
  C4,
  C5,
  C5b,
  C6,
  C7,
} from "../../src/shared/deploy-words"
import { fitsOneLine, keepsTheHabits } from "../support/line-rules"

describe("the deploy's own lines, exactly (contracts/cli.md)", () => {
  test("C1: another deploy reached the server first, for a deploy and for a rollback", () => {
    expect(C1("shop", "prod-1", 42, false)).toBe(
      "Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run zekno deploy again to deploy on top of it."
    )
    expect(C1("shop", "prod-1", 42, true)).toBe(
      "Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run zekno rollback again to deploy on top of it."
    )
  })

  test("C2: it cannot tell which of two deploys numbered the same ran", () => {
    expect(C2("shop", "prod-1", 42)).toBe(
      "prod-1 holds deploy 42 of shop, and this machine signed a deploy 42 whose answer never came. zekno cannot tell which of the two ran. Run zekno deploy again to settle it."
    )
  })

  test("C6: signed in the older format, the command in backticks", () => {
    expect(C6("prod-1", "0.1.0", "0.1.1")).toBe(
      "The runner on prod-1 is version 0.1.0, older than this zekno's 0.1.1, so this deploy was signed in the older format. Run `zekno server update prod-1` to bring it to 0.1.1."
    )
  })

  test("C7: a runner that speaks a newer protocol, nothing signed", () => {
    expect(C7("prod-1", "0.1.2", "0.1.1")).toBe(
      "The runner on prod-1 is version 0.1.2, newer than this zekno's 0.1.1, and speaks a newer protocol. Update zekno to deploy to prod-1. Nothing was signed."
    )
  })

  test("each refusal's first sentence fits one line beside its mark: at most 98 characters", () => {
    for (const refusal of [
      C1("shop", "prod-1", 42, false),
      C1("shop", "prod-1", 42, true),
      C2("shop", "prod-1", 42),
      C7("prod-1", "0.1.2", "0.1.1"),
    ])
      fitsOneLine(refusal)
  })

  test("no em dash, and the runner is never called an agent", () => {
    for (const line of [
      C1("shop", "prod-1", 42, false),
      C1("shop", "prod-1", 42, true),
      C2("shop", "prod-1", 42),
      C4("DATABASE_URL", "shop"),
      C5("DATABASE_URL", "shop", "prod-1"),
      C5b("DATABASE_URL", "shop", "prod-1"),
      C6("prod-1", "0.1.0", "0.1.1"),
      C7("prod-1", "0.1.2", "0.1.1"),
    ])
      keepsTheHabits(line)
  })
})

describe("a secret that stops a deploy before anything is signed (C4, C5, C5b)", () => {
  test("C4: set by someone who is no longer in the team, the commands in backticks", () => {
    expect(C4("DATABASE_URL", "shop")).toBe(
      "DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it. Set it again with `zekno secret set DATABASE_URL`, or remove it with `zekno secret rm DATABASE_URL`. Nothing was signed."
    )
  })

  test("C5: the server holds a secret this machine cannot check", () => {
    expect(C5("DATABASE_URL", "shop", "prod-1")).toBe(
      "prod-1 holds DATABASE_URL for shop, and this machine cannot check who set it. Set it again with `zekno secret set DATABASE_URL`, or remove it with `zekno secret rm DATABASE_URL`. Nothing was signed."
    )
  })

  test("C5b: the server holds a newer secret than the one set on this machine (approved 2026-11-18)", () => {
    expect(C5b("DATABASE_URL", "shop", "prod-1")).toBe(
      "prod-1 holds a newer DATABASE_URL for shop than the one set on this machine. Set it again with `zekno secret set DATABASE_URL` to replace it, or remove it with `zekno secret rm DATABASE_URL`. Nothing was signed."
    )
  })

  test("each first sentence fits one line beside its mark, with prod-1, DATABASE_URL and shop", () => {
    fitsOneLine(C4("DATABASE_URL", "shop"))
    fitsOneLine(C5("DATABASE_URL", "shop", "prod-1"))
    fitsOneLine(C5b("DATABASE_URL", "shop", "prod-1"))
  })

  test("one blocked name: exactly its sentence", () => {
    expect(
      blockedLines([{ name: "DATABASE_URL", why: "former_member" }], {
        app: "shop",
        server: "prod-1",
      })
    ).toBe(C4("DATABASE_URL", "shop"))
    expect(
      blockedLines([{ name: "DATABASE_URL", why: "cannot_check" }], {
        app: "shop",
        server: "prod-1",
      })
    ).toBe(C5("DATABASE_URL", "shop", "prod-1"))
    expect(
      blockedLines([{ name: "DATABASE_URL", why: "newer_on_server" }], {
        app: "shop",
        server: "prod-1",
      })
    ).toBe(C5b("DATABASE_URL", "shop", "prod-1"))
  })

  test("several: one line per name in name order, each without its last sentence, then `Nothing was signed.` once", () => {
    expect(
      blockedLines(
        [
          { name: "PAYMENTS_KEY", why: "newer_on_server" },
          { name: "DATABASE_URL", why: "former_member" },
          { name: "API_TOKEN", why: "cannot_check" },
        ],
        { app: "shop", server: "prod-1" }
      )
    ).toBe(
      [
        "prod-1 holds API_TOKEN for shop, and this machine cannot check who set it. Set it again with `zekno secret set API_TOKEN`, or remove it with `zekno secret rm API_TOKEN`.",
        "DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it. Set it again with `zekno secret set DATABASE_URL`, or remove it with `zekno secret rm DATABASE_URL`.",
        "prod-1 holds a newer PAYMENTS_KEY for shop than the one set on this machine. Set it again with `zekno secret set PAYMENTS_KEY` to replace it, or remove it with `zekno secret rm PAYMENTS_KEY`. Nothing was signed.",
      ].join("\n")
    )
  })
})
