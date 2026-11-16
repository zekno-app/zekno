/**
 * Characters drawn as nothing (specs/010-app-settings, security review S2):
 * a value that is signed and also shown may not hold a character zekno's
 * drawing hides, so what a person reads is what is signed. One definition,
 * `holdsHidden` in server/sanitize.ts, which every character `sanitize`
 * takes out meets; the reader refuses it in the start command (SV9 (g)) and
 * in a plain value (SV24), the only settings that take a character outside
 * ASCII, and every name and the other values are held to ASCII patterns.
 * `readTyped` refuses the same for `zekno settings set` and the screen.
 * Ordinary text in any script, accents, combining marks and emoji without
 * joiners stay allowed.
 */
import { describe, expect, test } from "bun:test"

import { holdsHidden, sanitize } from "../../src/server/sanitize"
import { faultSentence } from "../../src/settings/file"
import { checkSettings, isSettings } from "../../src/settings/schema"
import {
  checkImage,
  checkMountPath,
  checkPlainName,
  checkPlainValue,
  checkSecretName,
  checkServiceName,
  checkStart,
  checkVolumeName,
  readTyped,
} from "../../src/settings/values"

/** One of each kind the review named, and the others Unicode draws as nothing. */
const HIDDEN: readonly [string, string][] = [
  ["zero-width space", "\u200b"],
  ["zero-width non-joiner", "\u200c"],
  ["zero-width joiner", "\u200d"],
  ["word joiner", "\u2060"],
  ["invisible times", "\u2062"],
  ["soft hyphen", "\u00ad"],
  ["left-to-right mark", "\u200e"],
  ["right-to-left mark", "\u200f"],
  ["Arabic letter mark", "\u061c"],
  ["right-to-left embedding", "\u202b"],
  ["pop directional formatting", "\u202c"],
  ["right-to-left override", "\u202e"],
  ["first strong isolate", "\u2068"],
  ["pop directional isolate", "\u2069"],
  ["tag: language", "\u{e0001}"],
  ["tag: letter a", "\u{e0061}"],
  ["cancel tag", "\u{e007f}"],
  ["Hangul filler", "\u3164"],
  ["Hangul choseong filler", "\u115f"],
  ["Hangul jungseong filler", "\u1160"],
  ["halfwidth Hangul filler", "\uffa0"],
  ["variation selector 1", "\ufe00"],
  ["variation selector 17", "\u{e0100}"],
  ["Mongolian free variation selector", "\u180b"],
  ["Mongolian vowel separator", "\u180e"],
  ["combining grapheme joiner", "\u034f"],
  ["Khmer inherent vowel", "\u17b4"],
  ["interlinear annotation anchor", "\ufff9"],
  ["musical symbol begin beam", "\u{1d173}"],
  ["byte order mark inside", "\ufeff"],
  ["line separator", "\u2028"],
  ["paragraph separator", "\u2029"],
  ["emoji form after a letter", "\ufe0f"],
  ["text form after a letter", "\ufe0e"],
]

/** Text a person reads as it is: kept. */
const SEEN: readonly [string, string][] = [
  ["Japanese", "東京"],
  ["Cyrillic", "Привет"],
  ["accent, one character", "café"],
  ["accent, combining", "cafe\u0301"],
  ["two combining marks (Vietnamese)", "e\u0323\u0302"],
  ["thirty combining marks", `ok${"\u0301".repeat(30)}`],
  ["emoji", "🚀"],
  ["emoji with its emoji form", "❤\ufe0f"],
  ["emoji with its text form", "☺\ufe0e"],
  ["emoji with a skin tone", "👍\u{1f3fd}"],
  ["flag", "🇫🇷"],
  ["no-break space", "a\u00a0b"],
  ["ideographic space", "a\u3000b"],
  ["Braille blank", "a\u2800b"],
  ["noncharacter", "\ufdd0"],
]

describe("holdsHidden, the one definition (server/sanitize.ts)", () => {
  test("each kind the review named, alone, after a letter and inside a word", () => {
    for (const [what, char] of HIDDEN)
      for (const text of [char, `true${char}`, `pro${char}duction`])
        expect({ what, text, hidden: holdsHidden(text) }).toEqual({
          what,
          text,
          hidden: true,
        })
  })

  test("text in any script, accents, combining marks, emoji without joiners and spaces that draw as space are seen", () => {
    for (const [what, text] of SEEN)
      expect({ what, hidden: holdsHidden(text) }).toEqual({
        what,
        hidden: false,
      })
  })

  test("an emoji joined by a zero-width joiner is refused, its parts alone are not", () => {
    expect(holdsHidden("👨\u200d👩\u200d👧")).toBe(true)
    expect(holdsHidden("👨👩👧")).toBe(false)
    // A form selector after another, or after a digit, chooses nothing.
    expect(holdsHidden("❤\ufe0f\ufe0f")).toBe(true)
    expect(holdsHidden("1\ufe0f")).toBe(true)
  })

  test("every character sanitize takes out when it draws is one holdsHidden refuses", () => {
    for (let code = 0; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue
      const char = String.fromCodePoint(code)
      // A tab becomes spaces when drawn; it is a control character all the same.
      if (char !== "\t" && sanitize(`a${char}`) === "a" && !holdsHidden(char))
        throw new Error(
          `U+${code.toString(16)} is taken out when drawn, and allowed`
        )
    }
  })
})

/** The sentence a file stops with. */
function sentence(text: string): string {
  const read = checkSettings(text, "zekno.app.json")
  if (isSettings(read)) throw new Error("the file was read")
  return faultSentence(read, "zekno.app.json")
}

const fileWith = (service: Record<string, unknown>): string =>
  JSON.stringify({
    zekno: 1,
    services: { web: { source: { image: "nginx:1.27" }, ...service } },
  })

const HIDDEN_RULE =
  "use no invisible character, such as a zero-width space or a right-to-left mark."

describe("the reader (contracts/settings-file.md)", () => {
  test("in a start command: SV9 (g); in a plain value: SV24, naming the place and never the content", () => {
    for (const [what, char] of HIDDEN) {
      // U+FEFF, U+2028 and U+2029 were refused before as control characters, with SV9 (e) and SV24's first rule.
      const control = ["\ufeff", "\u2028", "\u2029"].includes(char)
      const start = sentence(
        fileWith({ deploy: { start: `bun run start${char}` } })
      )
      expect({ what, start }).toEqual({
        what,
        start: `zekno.app.json could not be read as settings. web, deploy.start: ${control ? "use one line with no control character." : HIDDEN_RULE}`,
      })
      const plain = sentence(
        fileWith({ variables: { plain: { NODE_ENV: `production${char}` } } })
      )
      expect({ what, plain }).toEqual({
        what,
        plain: `zekno.app.json could not be read as settings. web, variables.plain.NODE_ENV: ${control ? "use a value in quotes, one line with no control character, at most 4096 characters." : HIDDEN_RULE}`,
      })
      expect(plain).not.toContain("production")
    }
  })

  test("the review's own values: production U+200B, true U+E0001, app. U+00AD example.com, on U+3164, bun run start U+2060", () => {
    for (const [name, value] of [
      ["NODE_ENV", "production\u200b"],
      ["REQUIRE_AUTH", "true\u{e0001}"],
      ["ALLOWED_HOST", "app.\u00adexample.com"],
      ["HANGUL", "on\u3164"],
    ] as const)
      expect(
        sentence(fileWith({ variables: { plain: { [name]: value } } }))
      ).toBe(
        `zekno.app.json could not be read as settings. web, variables.plain.${name}: ${HIDDEN_RULE}`
      )
    expect(
      sentence(fileWith({ deploy: { start: "bun run start\u2060" } }))
    ).toBe(
      `zekno.app.json could not be read as settings. web, deploy.start: ${HIDDEN_RULE}`
    )
  })

  test("text a person reads as it is stays allowed in both", () => {
    for (const [what, text] of SEEN) {
      const read = checkSettings(
        fileWith({
          deploy: { start: `echo '${text}'` },
          variables: { plain: { GREETING: text } },
        }),
        "zekno.app.json"
      )
      expect({ what, read: isSettings(read) }).toEqual({ what, read: true })
    }
  })

  test("every name and every other value is held to an ASCII pattern, which refuses each kind already", () => {
    for (const [what, char] of HIDDEN) {
      const refused = {
        service: checkServiceName(`web${char}`),
        plainName: checkPlainName(`NAME${char}`),
        secret: checkSecretName(`NAME${char}`),
        volume: checkVolumeName(`data${char}`),
        image: checkImage(`nginx:1.27${char}`),
        mount: checkMountPath(`/data${char}`),
      }
      expect({
        what,
        all: Object.values(refused).every((rule) => rule !== undefined),
      }).toEqual({ what, all: true })
    }
  })
})

describe("readTyped: zekno settings set and the screen refuse the same", () => {
  test("a start command and a plain value typed with any of them", () => {
    for (const [what, char] of HIDDEN) {
      const control = ["\ufeff", "\u2028", "\u2029"].includes(char)
      expect({
        what,
        start: readTyped({ service: "web", key: "start" }, `bun run${char}`),
        plain: readTyped(
          { service: "web", key: "plain", name: "X" },
          `true${char}`
        ),
      }).toEqual({
        what,
        start: {
          refused: control
            ? "Use one line with no control character."
            : "Use no invisible character, such as a zero-width space or a right-to-left mark.",
        },
        plain: {
          refused: control
            ? "Use one line with no control character, at most 4096 characters."
            : "Use no invisible character, such as a zero-width space or a right-to-left mark.",
        },
      })
    }
    expect(checkStart("echo 'café 東京 🚀'")).toBeUndefined()
    expect(checkPlainValue("café 東京 🚀")).toBeUndefined()
  })
})
