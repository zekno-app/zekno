/**
 * The words of feature 015 that design/lines.md does not hold
 * (specs/015-domains-https; src/domains/words-extra.ts), pinned word for
 * word with lines.md's example values, so a change to one is seen. Each is
 * the maintainer's to approve.
 */
import { describe, expect, test } from "bun:test"

import {
  hostNetworkChecked,
  listTitle,
  noContainerChecked,
  NOT_LINKED_HERE,
  notAsked,
  pointAt,
  proxyNotLoaded,
  proxyPortTaken,
} from "../../src/domains/words-extra"

describe("the words lines.md does not hold", () => {
  test("zekno domain: its first line, a server not asked, D4 without the server's address, a folder not linked", () => {
    expect(listTitle("shop", "prod-1")).toBe("shop on prod-1")
    expect(notAsked("prod-1")).toBe("prod-1 was not asked")
    expect(pointAt("prod-1")).toBe("point it at the public address of prod-1")
    expect(NOT_LINKED_HERE).toBe(
      "This folder is not linked to an app. Run `zekno link` here, then `zekno domain` again."
    )
  })

  test("a checked service no domain reaches, in B17's and B18's pattern", () => {
    expect(noContainerChecked("worker")).toBe(
      "worker cannot be checked: no container of worker is running. Run `zekno logs` to see why."
    )
    expect(hostNetworkChecked("worker")).toBe(
      "worker cannot be checked: worker uses the host's network, which zekno cannot route to. Give worker a network of its own, then run `zekno deploy` again."
    )
  })

  test("B16's and B19's words for the server, after zekno server update", () => {
    expect(proxyPortTaken("prod-1", 80)).toBe(
      "prod-1 cannot answer for its domains: port 80 is in use by another program. Free ports 80 and 443 on prod-1, then run `zekno deploy` again."
    )
    expect(proxyNotLoaded("prod-1")).toBe(
      "prod-1 did not take the configuration of its domains, so it answers for the ones it had. Run `zekno doctor` to see why."
    )
  })
})
