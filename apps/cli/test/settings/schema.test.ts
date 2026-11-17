/**
 * Checking a settings file's text (specs/010-app-settings,
 * contracts/settings-file.md, "The settings", "Rules across settings", "The
 * order of checks", "What the sentences never hold"; tasks T010): every
 * file of the test set gives its settings or exactly its sentence, faults
 * come in the order of the contract, and no fault holds anything of the
 * file.
 */
import { describe, expect, test } from "bun:test"

import { CliError } from "../../src/cli/errors"
import { faultSentence, SETTINGS_BYTES } from "../../src/settings/file"
import { readJson, type JsonValue } from "../../src/settings/json"
import {
  checkSettings,
  checkSettingsValue,
  isSettings,
} from "../../src/settings/schema"
import type { Settings, SettingsFault } from "../../src/settings/types"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  FAULTY_FILES,
  FILES,
  lineOf,
  SENTINEL,
} from "../support/settings-files"

const FILE = "zekno.app.json"

/** The sentence a text stops with, as a person reads it. */
function sentence(text: string): string {
  const read = checkSettings(text, FILE)
  if (isSettings(read))
    throw new Error("expected a fault, the settings were read")
  return faultSentence(read, FILE)
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)
const IMAGE = "ghcr.io/acme/web:1.4.2"
const web = (sections: Record<string, unknown>, more = {}): string =>
  json({
    zekno: 1,
    services: { web: { source: { image: IMAGE }, ...sections }, ...more },
  })
const form = (said: string): string =>
  `${FILE} could not be read as settings. ${said}`

describe("the test set", () => {
  test("it holds a file for every sentence that a text can have", () => {
    const sentences = FAULTY_FILES.map((file) => file.expect.fault)
    for (const marker of [
      "is larger than the 64 KiB",
      "is not UTF-8 text.",
      "this is not JSON.",
      "the same name as line",
      "nested deeper than settings go.",
      "a text longer than 4096 characters.",
      "settings are one JSON object.",
      "zekno: use 1",
      "is written for a later version",
      'name at least one service, such as "web".',
      "at most 32 services.",
      "a service name is lowercase",
      "use an object of sections.",
      "deploy: use an object.",
      "a setting this zekno does not know",
      "a service needs an image",
      "use an image reference",
      "use a command, or leave start out",
      "a quote does not close.",
      "it runs without a shell",
      "use at most 4096 characters and 256 words.",
      "use one line with no control character.",
      "use a command in quotes",
      "use no, on-failure or always.",
      "use a size such as 512m or 1g.",
      "use a number of processors",
      "networking.port: use a port",
      "networking.publish: use a port",
      "set networking.port too",
      "publishes the same port.",
      "use a list of names",
      "a secret name uses letters",
      "is a name zekno keeps for itself.",
      "a name is there twice",
      "at most 256 names.",
      "use an object of names and values",
      "a variable name uses letters",
      "use a value in quotes",
      "it is a secret of web too.",
      "at most 128 variables.",
      "use an object of volume names",
      "a volume name is lowercase",
      "use an absolute path in the container",
      "two volumes are mounted at the same path.",
      "at most 16 volumes.",
      "they read more than 256 secrets",
      "sets a build for",
      "sets a pre-deploy command for",
      "sets a health check for",
      "sets replicas for",
      "sets a domain for",
    ])
      expect([marker, sentences.some((said) => said.includes(marker))]).toEqual(
        [marker, true]
      )
  })
})

describe("every file of the test set gives its settings, or exactly its sentence", () => {
  for (const file of FILES) {
    if (typeof file.text !== "string") continue
    const text = file.text
    test(file.name, () => {
      const read = checkSettings(text, FILE)
      if ("settings" in file.expect) {
        expect(read).toEqual(file.expect.settings)
      } else {
        expect(isSettings(read)).toBe(false)
        expect(faultSentence(read as SettingsFault, FILE)).toBe(
          file.expect.fault
        )
      }
    })
  }

  test("design.md's file gives the settings of data-model.md, in the file's order", () => {
    const read = checkSettings(DESIGN_FILE, FILE) as Settings
    expect(read).toEqual(DESIGN_SETTINGS)
    expect(read.services.map(([name]) => name)).toEqual(["web", "worker"])
    expect(read.services[0]![1].secrets).toEqual([
      "DATABASE_URL",
      "SESSION_KEY",
    ])
  })
})

describe("checkSettingsValue: steps 3 to 6 on a value already read (specs/012-templates, tasks T002)", () => {
  // Every text of the test set that reaches step 3: within the size, JSON, and an object.
  const reaching = FILES.filter(
    (file) =>
      typeof file.text === "string" &&
      Buffer.byteLength(file.text) <= SETTINGS_BYTES &&
      "value" in readJson(file.text.replace(/^\ufeff/, ""))
  )

  test("the test set holds texts that reach step 3, good and faulty", () => {
    expect(reaching.length).toBeGreaterThan(70)
    expect(reaching.some((file) => "settings" in file.expect)).toBe(true)
    expect(reaching.some((file) => "fault" in file.expect)).toBe(true)
  })

  for (const file of reaching) {
    const text = file.text as string
    test(`${file.name}: the same result as checkSettings of the text`, () => {
      const read = readJson(text.replace(/^\ufeff/, ""))
      if (!("value" in read)) throw new Error("the text is not JSON")
      expect(
        checkSettingsValue(
          read.value as ReadonlyMap<string, JsonValue>,
          read.lines,
          read.numbers
        )
      ).toEqual(checkSettings(text, FILE))
    })
  }
})

describe("no fault holds anything of the file", () => {
  for (const file of FAULTY_FILES) {
    if (typeof file.text !== "string") continue
    const text = file.text
    test(file.name, () => {
      const read = checkSettings(text, FILE) as SettingsFault
      expect(JSON.stringify(read)).not.toContain(SENTINEL)
      const said = faultSentence(read, FILE)
      expect(said).not.toContain(SENTINEL)
      const error = new CliError(said)
      expect(error.message).not.toContain(SENTINEL)
      expect(error.stack ?? "").not.toContain(SENTINEL)
    })
  }
})

describe("the order of checks (contracts/settings-file.md)", () => {
  test("1 before 2: a text too large is SR3, whatever it holds", () => {
    expect(sentence(`{${" ".repeat(70_000)}`)).toBe(
      `${FILE} is larger than the 64 KiB a settings file may be.`
    )
  })

  test("2 in the order of the text: a key twice before a later syntax fault", () => {
    expect(sentence('{\n"zekno": 1,\n"zekno": 1,\n"services": ,\n}')).toBe(
      form("line 3: the same name as line 2.")
    )
    expect(sentence('{\n"zekno": ,\n"zekno": 1}')).toBe(
      form("line 2: this is not JSON.")
    )
  })

  test("2 before 3: not JSON comes before a wrong zekno", () => {
    expect(sentence('{"zekno": 5, "services": [1,]}')).toBe(
      form("line 1: this is not JSON.")
    )
  })

  test("3 before 4: zekno before a key not known that comes first in the text", () => {
    expect(sentence(json({ [SENTINEL]: 1, zekno: "1", services: {} }))).toBe(
      form("zekno: use 1, the version of settings this zekno reads.")
    )
    expect(sentence(json({ services: {} }))).toBe(
      form("zekno: use 1, the version of settings this zekno reads.")
    )
    for (const zekno of ["1.0", "0", "-1", "1e0", "true", "null", '"1"'])
      expect(sentence(`{"zekno": ${zekno}, "services": {}}`)).toBe(
        form("zekno: use 1, the version of settings this zekno reads.")
      )
    for (const zekno of ["2", "10", "12345678901234567890"])
      expect(sentence(`{"x": 1, "zekno": ${zekno}, "services": 5}`)).toBe(
        `${FILE} is written for a later version of zekno. Update zekno to use it.`
      )
  })

  test("4 before 5: a key not known late in the text before a wrong value early in it", () => {
    const text = web(
      { deploy: { memory: "lots" } },
      { worker: { source: { image: IMAGE }, [SENTINEL]: 1 } }
    )
    expect(sentence(text)).toBe(
      form(
        `worker: a setting this zekno does not know (line ${lineOf(text, SENTINEL)}).`
      )
    )
  })

  test("4: a later setting and a key not known, whichever comes first in the file", () => {
    expect(sentence(web({ deploy: { replicas: 2, [SENTINEL]: 1 } }))).toBe(
      `${FILE} sets replicas for web. Several copies of a service are not in this version of zekno yet.`
    )
    const text = web({ deploy: { [SENTINEL]: 1, replicas: 2 } })
    expect(sentence(text)).toBe(
      form(
        `web, deploy: a setting this zekno does not know (line ${lineOf(text, SENTINEL)}).`
      )
    )
  })

  test("4: a later setting in its own place only; elsewhere it is a key not known", () => {
    const text = web({ build: "." })
    expect(sentence(text)).toBe(
      form(
        `web: a setting this zekno does not know (line ${lineOf(text, '"build"')}).`
      )
    )
    const domains = web({ deploy: { domains: ["x"] } })
    expect(sentence(domains)).toBe(
      form(
        `web, deploy: a setting this zekno does not know (line ${lineOf(domains, '"domains"')}).`
      )
    )
  })

  test("4: keys a prototype has are keys not known", () => {
    for (const key of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      const top = `{"zekno": 1, "${key}": {}, "services": {"web": {"source": {"image": "${IMAGE}"}}}}`
      expect(sentence(top)).toBe(
        form("A setting this zekno does not know (line 1).")
      )
      const inService = `{"zekno": 1, "services": {"web": {"source": {"image": "${IMAGE}"}, "${key}": {}}}}`
      expect(sentence(inService)).toBe(
        form("web: a setting this zekno does not know (line 1).")
      )
      const inSection = `{"zekno": 1, "services": {"web": {"source": {"image": "${IMAGE}", "${key}": 1}}}}`
      expect(sentence(inSection)).toBe(
        form("web, source: a setting this zekno does not know (line 1).")
      )
    }
  })

  test("4: a service whose name breaks its rule is not entered; step 5 refuses it", () => {
    const text = json({
      zekno: 1,
      services: { [SENTINEL]: { [SENTINEL]: 1, deploy: { replicas: 2 } } },
    })
    expect(sentence(text)).toBe(
      form(
        `services: a service name is lowercase letters, digits and hyphens, and starts with a letter (line ${lineOf(text, SENTINEL)}).`
      )
    )
  })

  test("5 in the order of the text", () => {
    expect(
      sentence(
        json({
          zekno: 1,
          services: {
            web: { source: { image: "Bad" }, deploy: { memory: "lots" } },
          },
        })
      )
    ).toBe(
      form(
        "web, source.image: use an image reference, such as ghcr.io/acme/web:1.4.2."
      )
    )
    expect(
      sentence(
        json({
          zekno: 1,
          services: {
            web: { deploy: { memory: "lots" }, source: { image: "Bad" } },
          },
        })
      )
    ).toBe(form("web, deploy.memory: use a size such as 512m or 1g."))
  })

  test("5: a missing image is noticed where its service ends", () => {
    expect(
      sentence(
        json({
          zekno: 1,
          services: { web: { deploy: { memory: "lots" } }, api: { source: 5 } },
        })
      )
    ).toBe(form("web, deploy.memory: use a size such as 512m or 1g."))
    expect(
      sentence(
        json({
          zekno: 1,
          services: { web: { deploy: {} }, api: { source: 5 } },
        })
      )
    ).toBe(
      form(
        "web, source.image: a service needs an image, such as ghcr.io/acme/web:1.4.2."
      )
    )
  })

  test("5: a name before its value", () => {
    const text = web({ variables: { plain: { "1A": 5 } } })
    expect(sentence(text)).toBe(
      form(
        `web, variables.plain: a variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line ${lineOf(text, '"1A"')}).`
      )
    )
  })

  test("5: a count is at the place of its list or object, so it is said before a fault of an entry", () => {
    const secrets = [
      ...Array.from({ length: 300 }, (_, at) => `S${at}`),
      "1A",
      5,
    ]
    expect(sentence(web({ variables: { secrets } }))).toBe(
      form("web, variables.secrets: at most 256 names.")
    )
    const plain = Object.fromEntries(
      Array.from({ length: 130 }, (_, at) => [`V${at}`, at === 0 ? 5 : "x"])
    )
    expect(sentence(web({ variables: { plain } }))).toBe(
      form("web, variables.plain: at most 128 variables.")
    )
    const volumes = Object.fromEntries(
      Array.from({ length: 17 }, (_, at) => [
        `v${at}`,
        at === 0 ? "x" : `/${at}`,
      ])
    )
    expect(sentence(web({ volumes }))).toBe(
      form("web, volumes: at most 16 volumes.")
    )
    const services = Object.fromEntries(
      Array.from({ length: 33 }, (_, at) => [
        `s${at}`,
        at === 0 ? 5 : { source: { image: IMAGE } },
      ])
    )
    expect(sentence(json({ zekno: 1, services }))).toBe(
      form("services: at most 32 services.")
    )
  })

  test("5 before 6: a wrong value comes before a rule across settings", () => {
    expect(
      sentence(
        web({ networking: { publish: 80 }, deploy: { restart: "sometimes" } })
      )
    ).toBe(form("web, deploy.restart: use no, on-failure or always."))
  })

  test("6: the rules across settings in the order listed, whatever the order of the text", () => {
    const publishes = (port: number | undefined) => ({
      source: { image: IMAGE },
      networking: { ...(port === undefined ? {} : { port }), publish: 80 },
    })
    // SV16 is met first in the text, SV15 is said first.
    expect(
      sentence(
        json({
          zekno: 1,
          services: {
            a: publishes(1),
            b: publishes(2),
            c: publishes(undefined),
          },
        })
      )
    ).toBe(
      form(
        "c, networking.publish: set networking.port too, the port it reaches."
      )
    )
    expect(
      sentence(
        json({
          zekno: 1,
          services: {
            a: {
              source: { image: IMAGE },
              variables: { secrets: ["X"], plain: { X: "1" } },
            },
            b: publishes(1),
            c: publishes(2),
          },
        })
      )
    ).toBe(form("c, networking.publish: b publishes the same port."))
    expect(
      sentence(
        web({
          volumes: { a: "/d", b: "/d" },
          variables: { secrets: ["X"], plain: { X: "1" } },
        })
      )
    ).toBe(
      form(
        "web, variables.plain.X: it is a secret of web too. Keep it in one place."
      )
    )
    expect(
      sentence(
        web(
          { volumes: { a: "/d", b: "/d" } },
          {
            worker: {
              source: { image: IMAGE },
              variables: {
                secrets: Array.from({ length: 256 }, (_, at) => `B${at}`),
              },
            },
            api: {
              source: { image: IMAGE },
              variables: { secrets: ["C"] },
            },
          }
        )
      )
    ).toBe(form("web, volumes: two volumes are mounted at the same path."))
  })

  test('"zekno": 2 gives SL0 even with other faults after it', () => {
    expect(
      sentence(
        `{"zekno": 2, "${SENTINEL}": 1, "services": {"${SENTINEL}": {"deploy": {"memory": "lots"}}}}`
      )
    ).toBe(
      `${FILE} is written for a later version of zekno. Update zekno to use it.`
    )
  })
})
