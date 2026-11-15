import { describe, expect, test } from "bun:test"
import { Box, renderToString, Text } from "ink"

import { Confirm } from "../src/ui/confirm"
import { KeyHints } from "../src/ui/key-hints"
import { Panel } from "../src/ui/panel"
import { MARKER, Select, SelectRow } from "../src/ui/select"
import { SPINNER_FRAMES, Stages } from "../src/ui/stages"
import { TextQuestion } from "../src/ui/text-input"
import { BRAND, BRAND_DARKER, themeFor } from "../src/ui/theme"

const draw = (node: React.ReactNode, columns = 100) => renderToString(node, { columns })
const lines = (text: string) => text.split("\n")

describe("the theme", () => {
  test("brand on a dark terminal, brand-darker on a light one; state in the terminal's standard colours", () => {
    expect(themeFor("dark")).toEqual({ background: "dark", brand: "#2383e2", success: "green", danger: "red", warning: "yellow" })
    expect(themeFor("light").brand).toBe("#1a73d1")
    expect([BRAND, BRAND_DARKER]).toEqual(["#2383e2", "#1a73d1"])
  })

  test("the colours match the tokens of packages/ui", async () => {
    const css = await Bun.file(new URL("../../../packages/ui/src/styles/globals.css", import.meta.url)).text()
    expect(css).toContain(`--brand: ${BRAND};`)
    expect(css).toContain(`--brand-darker: ${BRAND_DARKER};`)
  })
})

describe("a panel", () => {
  test("its title is on its top line, as on the board 'A deploy in progress'", () => {
    const out = draw(
      <Panel title="Deploy 5" width={40}>
        <Text>app demo</Text>
        <Text>server prod</Text>
      </Panel>
    )
    expect(lines(out)).toEqual([
      "╭─ Deploy 5 ───────────────────────────╮",
      "│ app demo                             │",
      "│ server prod                          │",
      "╰──────────────────────────────────────╯",
    ])
  })

  test("every line is as wide as the panel, whatever its tone or width", () => {
    for (const tone of ["focus", "plain", "quiet", "danger", "warning"] as const) {
      for (const width of [20, 47, 80]) {
        const out = lines(draw(<Panel title="Docker said" tone={tone} width={width}><Text>pull access denied for example/web</Text></Panel>))
        expect(out[0]!.startsWith("╭─ Docker said ")).toBe(true)
        for (const line of out) expect([...line].length).toBe(width)
      }
    }
  })

  test("without a width it fills its column, or fits its content in a row", () => {
    const column = lines(draw(<Box flexDirection="column" width={30}><Panel title="A"><Text>a</Text></Panel></Box>))
    expect(column[0]).toBe(`╭─ A ${"─".repeat(24)}╮`)
    const row = lines(draw(<Box><Panel title="Team code"><Text>J4QF-AM29</Text></Panel></Box>))
    expect(row[0]).toBe("╭─ Team code ╮")
    expect(row[1]).toBe("│ J4QF-AM29  │")
  })
})

describe("the stage row", () => {
  test("done, in progress, failed and not reached each have their own symbol", () => {
    const out = draw(
      <Stages
        stages={[
          { label: "Checked", state: "done" },
          { label: "Signed", state: "done" },
          { label: "Sent", state: "active" },
          { label: "Starting", state: "pending" },
        ]}
      />
    )
    expect(out).toContain("✔ Checked   ✔ Signed   ")
    expect(out).toContain(`${SPINNER_FRAMES[0]} Sent`)
    expect(out).toContain("○ Starting")
  })

  test("a failed start, as on the board 'zekno deploy: success and failure'", () => {
    const out = draw(
      <Stages
        gap={2}
        stages={[
          { label: "Checked", state: "done" },
          { label: "Signed", state: "done" },
          { label: "Sent", state: "done" },
          { label: "Starting", state: "failed" },
        ]}
      />
    )
    expect(out).toBe("✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting")
  })
})

describe("the key hints", () => {
  test("each key and what it does, as the last line of the board 'Home'", () => {
    const out = draw(
      <KeyHints
        hints={[
          ["↑↓", "move"],
          ["←→", "pane"],
          ["enter", "open"],
          ["a", "add"],
          ["?", "help"],
          ["q", "quit"],
        ]}
      />
    )
    expect(out).toBe("↑↓ move  ←→ pane  enter open  a add  ? help  q quit")
  })

  test("a line wider than the window wraps; nothing is left out", () => {
    const hints = [
      ["d", "deploy"],
      ["r", "roll back to selected"],
      ["l", "logs"],
      ["s", "set secret"],
      ["x", "remove secret"],
      ["tab", "pane"],
      ["esc", "back"],
    ] as const
    const out = draw(<KeyHints hints={hints} />, 40)
    for (const [key, does] of hints) expect(out).toContain(`${key} ${does}`)
    for (const line of lines(out)) expect([...line].length).toBeLessThanOrEqual(40)
  })
})

describe("a list", () => {
  test("the selected row has the arrow and the others keep its space empty", () => {
    const out = draw(
      <Select
        selected={1}
        items={[
          { key: "a", label: "prod" },
          { key: "b", label: "staging" },
          { key: "c", label: "+ add a server", muted: true },
        ]}
      />
    )
    expect(lines(out)).toEqual(["  prod", `${MARKER} staging`, "  + add a server"])
  })

  test("a selection past the end marks the last row", () => {
    const out = draw(<Select selected={9} items={[{ key: "a", label: "one" }, { key: "b", label: "two" }]} />)
    expect(lines(out)).toEqual(["  one", "❯ two"])
  })

  test("a row with columns is built from SelectRow", () => {
    const out = draw(
      <SelectRow selected>
        <Text>DATABASE_URL</Text>
        <Text> not set</Text>
      </SelectRow>
    )
    expect(out).toBe("❯ DATABASE_URL not set")
  })
})

describe("a question", () => {
  test("a visible answer, as on the board 'First run: no team yet'", () => {
    // The cursor after the answer is a space drawn in reverse; without colour it is trimmed.
    expect(draw(<TextQuestion label="Your name" value="ada" />)).toBe("? Your name › ada")
  })

  test("a hidden answer shows only the cursor and its note, as on the board 'Set a secret'", () => {
    expect(draw(<TextQuestion label="Value" hidden note="hidden as you type" />)).toBe("? Value ›   hidden as you type")
  })

  test("a question with fixed answers, as on the board 'Two questions the app asks'", () => {
    const out = draw(
      <Confirm
        title="Remember this folder?"
        choices={[
          { key: "enter", answer: "yes", does: "write it and deploy" },
          { key: "n", answer: "skip", does: "deploy without it" },
          { key: "esc", answer: "no", does: "cancel" },
        ]}
      >
        <Text>Write zekno.json here, so this folder always deploys demo to prod.</Text>
      </Confirm>,
      80
    )
    expect(lines(out)[0]!.startsWith("╭─ Remember this folder? ─")).toBe(true)
    expect(out).toContain("Write zekno.json here, so this folder always deploys demo to prod.")
    expect(out).toContain("enter write it and deploy  n deploy without it  esc cancel")
  })
})
