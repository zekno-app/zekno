import { describe, expect, test } from "bun:test"

import * as content from "./index"

describe("entity counts", () => {
  test("three parties in order", () => {
    expect(content.parties.map((party) => party.id)).toEqual([
      "machine",
      "zekno",
      "server",
    ])
  })

  test("five deploy steps in order", () => {
    expect(content.steps.map((step) => step.id)).toEqual([
      "encrypt",
      "sign",
      "relay",
      "verify",
      "run",
    ])
  })

  test("four feature blocks and four team stages", () => {
    expect(content.features.map((feature) => feature.id)).toEqual([
      "leak",
      "signature",
      "uptime",
      "team",
    ])
    expect(content.teamStages.map((stage) => stage.id)).toEqual([
      "team",
      "sign",
      "history",
      "servers",
    ])
  })

  test("six threat scenarios, three of them not protected", () => {
    const { scenarios } = content.threats
    expect(scenarios).toHaveLength(6)
    expect(
      scenarios.filter((scenario) => scenario.outcome === "unprotected")
    ).toHaveLength(3)
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(6)
  })

  test("six comparison rows across three columns", () => {
    expect(content.comparison.rows).toHaveLength(6)
    expect(content.comparison.columns.map((column) => column.id)).toEqual([
      "zekno",
      "managed",
      "scripts",
    ])
  })

  test("five open-source parts, exactly one closed", () => {
    expect(content.openSource.parts).toHaveLength(5)
    expect(
      content.openSource.parts.filter((part) => part.status === "closed")
    ).toHaveLength(1)
  })

  test("eight FAQ items with unique ids", () => {
    expect(content.faq.items).toHaveLength(8)
    expect(new Set(content.faq.items.map((item) => item.id)).size).toBe(8)
  })
})

describe("sample data", () => {
  test("each sample secret keeps its width when encrypted", () => {
    for (const secret of content.sampleSecrets) {
      expect(secret.cipher.length).toBe(secret.value.length)
    }
  })

  test("leak demo rows keep their width when re-scrambled", () => {
    for (const row of content.demos.leak.rows) {
      expect(row.b.length).toBe(row.a.length)
    }
  })

  test("sample secrets do not look like real credentials", () => {
    for (const secret of content.sampleSecrets) {
      expect(secret.value).toMatch(/demo|example/)
    }
  })

  test("team history refers to known members", () => {
    const ids = content.team.members.map((member) => member.id)
    for (const entry of content.team.history) {
      expect(ids).toContain(entry.member)
    }
  })
})

describe("sourced claims", () => {
  test("every claim that names a company carries a source", () => {
    expect(content.why.sources).toHaveLength(3)
    for (const source of content.why.sources) {
      expect(source.href).toStartWith("https://")
    }
    const named = content.comparison.columns.filter((column) => column.id !== "zekno")
    for (const column of named) {
      expect(column.source).toStartWith("https://")
    }
  })
})
