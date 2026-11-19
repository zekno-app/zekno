/**
 * Every sentence and label of app settings, by its id (specs/010-app-settings,
 * tasks T009): the text words.ts gives for sample arguments, against the
 * text of the contracts. The expected strings are copied from the
 * contracts, not from the code. No sentence holds an em dash, and none
 * calls the runner an agent. It is one file, as words.ts is, so the two are
 * read side by side against the contracts.
 */
import { describe, expect, test } from "bun:test"

import * as words from "../../src/settings/words"
import {
  AS1,
  AS2,
  AS3,
  AS4,
  AS5,
  AS6,
  AS7,
  CS1,
  CS10,
  CS11,
  CS12,
  CS13,
  CS14,
  CS15,
  CS16,
  CS17,
  CS2,
  CS4,
  CS5,
  CS6,
  CS7,
  CS8,
  CS9,
  DP1,
  DP2,
  DP3,
  DP5,
  IN1,
  IN1_RULE,
  IN2,
  IN2_RULE,
  IN3,
  IN4,
  IN5,
  IN6,
  laterSentences,
  NOT_SET,
  notSettings,
  portShown,
  restartShown,
  settingWords,
  SH1,
  SH2,
  SH3,
  SH4,
  SJ1,
  SJ2,
  SJ3,
  SJ4,
  SJ5,
  SR1,
  SR1_LINKED,
  SR2,
  SR3,
  SR4,
  SR5,
  SR6,
  SR7,
  SR8,
  SR9,
  startRule,
  SV1,
  SV10,
  SV11,
  SV12,
  SV13,
  SV14,
  SV15,
  SV16,
  SV17,
  SV18,
  SV19,
  SV2,
  SV20,
  SV21,
  SV22,
  SV23,
  SV24,
  SV25,
  SV26,
  SV27,
  SV28,
  SV29,
  SV3,
  SV30,
  SV31,
  SV32,
  SV33,
  SV4,
  SV5,
  SV6,
  SV7,
  SV8,
  SV9,
  type PlaceRule,
} from "../../src/settings/words"

const F = "zekno.app.json"
/** A place and rule as a sentence says it after the first. */
const said = ({ place, rule }: PlaceRule) =>
  place === "" ? rule : `${place}: ${rule}`

describe("contracts/settings-file.md", () => {
  test("SR1 to SR9", () => {
    expect(SR1(F)).toBe("No settings file at zekno.app.json.")
    expect(SR1_LINKED("~/demo/zekno.json", F, "~/demo")).toBe(
      "~/demo/zekno.json names zekno.app.json, and there is no such file in ~/demo."
    )
    expect(SR2(F)).toBe("zekno.app.json is not a file.")
    expect(SR3(F)).toBe(
      "zekno.app.json is larger than the 64 KiB a settings file may be."
    )
    expect(SR4(F)).toBe("zekno.app.json is not UTF-8 text.")
    expect(SR5(F)).toBe("zekno.app.json could not be read.")
    expect(SR6(F)).toBe(
      "zekno.app.json was changed while zekno read it. Try again."
    )
    expect(SR7(F)).toBe(
      "zekno.app.json has more than one name on this disk (a hard link), so zekno cannot tell that it stays inside its folder."
    )
    expect(SR8(F)).toBe(
      "zekno.app.json belongs to another user, so zekno does not use it."
    )
    expect(SR9(F)).toBe(
      "zekno.app.json leads outside the folder that holds it. zekno does not follow it there."
    )
  })

  test("notSettings: the first sentence, then the place and the rule", () => {
    expect(
      notSettings(F, "web, deploy.memory", "use a size such as 512m or 1g.")
    ).toBe(
      "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."
    )
    expect(
      notSettings(F, "", "A setting this zekno does not know (line 3).")
    ).toBe(
      "zekno.app.json could not be read as settings. A setting this zekno does not know (line 3)."
    )
  })

  test("SJ1 to SJ5", () => {
    expect(said(SJ1(4))).toBe("line 4: this is not JSON.")
    expect(said(SJ2(7, 6))).toBe("line 7: the same name as line 6.")
    expect(said(SJ3(2))).toBe("line 2: nested deeper than settings go.")
    expect(said(SJ4(9))).toBe("line 9: a text longer than 4096 characters.")
    expect(said(SJ5)).toBe("line 1: settings are one JSON object.")
  })

  test("SV1 to SV33", () => {
    const cases: [PlaceRule, string][] = [
      [SV1, "zekno: use 1, the version of settings this zekno reads."],
      [SV2, 'services: name at least one service, such as "web".'],
      [SV3, "services: at most 32 services."],
      [
        SV4(5),
        "services: a service name is lowercase letters, digits and hyphens, and starts with a letter (line 5).",
      ],
      [SV5("web"), "web: use an object of sections."],
      [SV5("web", "deploy"), "web, deploy: use an object."],
      [
        SV6(9, "web", "deploy"),
        "web, deploy: a setting this zekno does not know (line 9).",
      ],
      [SV6(9, "web"), "web: a setting this zekno does not know (line 9)."],
      [SV6(9), "A setting this zekno does not know (line 9)."],
      [
        SV7("web"),
        "web, source.image: a service needs an image, such as ghcr.io/acme/web:1.4.2.",
      ],
      [
        SV8("web"),
        "web, source.image: use an image reference, such as ghcr.io/acme/web:1.4.2.",
      ],
      [
        SV9("web", "empty"),
        "web, deploy.start: use a command, or leave start out to run the image's own.",
      ],
      [SV9("web", "quote"), "web, deploy.start: a quote does not close."],
      [
        SV9("web", "shell"),
        "web, deploy.start: it runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
      ],
      [
        SV9("web", "long"),
        "web, deploy.start: use at most 4096 characters and 256 words.",
      ],
      [
        SV9("web", "control"),
        "web, deploy.start: use one line with no control character.",
      ],
      [
        SV9("web", "type"),
        'web, deploy.start: use a command in quotes, such as "bun run start".',
      ],
      [SV10("web"), "web, deploy.restart: use no, on-failure or always."],
      [SV11("web"), "web, deploy.memory: use a size such as 512m or 1g."],
      [
        SV12("web"),
        "web, deploy.cpus: use a number of processors, such as 0.5 or 2.",
      ],
      [SV13("web"), "web, networking.port: use a port from 1 to 65535."],
      [SV14("web"), "web, networking.publish: use a port from 1 to 65535."],
      [
        SV15("web"),
        "web, networking.publish: set networking.port too, the port it reaches.",
      ],
      [
        SV16("worker", "web"),
        "worker, networking.publish: web publishes the same port.",
      ],
      [
        SV17("web"),
        'web, variables.secrets: use a list of names, such as ["DATABASE_URL"].',
      ],
      [
        SV18("web", 14),
        "web, variables.secrets: a secret name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line 14).",
      ],
      [
        SV19("web", "PATH"),
        "web, variables.secrets: PATH is a name zekno keeps for itself.",
      ],
      [
        SV20("web", 14),
        "web, variables.secrets: a name is there twice (line 14).",
      ],
      [SV21("web"), "web, variables.secrets: at most 256 names."],
      [
        SV22("web"),
        'web, variables.plain: use an object of names and values, such as { "NODE_ENV": "production" }.',
      ],
      [
        SV23("web", 15),
        "web, variables.plain: a variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line 15).",
      ],
      [
        SV24("web", "NODE_ENV"),
        "web, variables.plain.NODE_ENV: use a value in quotes, one line with no control character, at most 4096 characters.",
      ],
      [
        SV25("web", "DATABASE_URL"),
        "web, variables.plain.DATABASE_URL: it is a secret of web too. Keep it in one place.",
      ],
      [SV26("web"), "web, variables.plain: at most 128 variables."],
      [
        SV27("web"),
        'web, volumes: use an object of volume names and mount paths, such as { "data": "/data" }.',
      ],
      [
        SV28("web", 17),
        "web, volumes: a volume name is lowercase letters, digits, hyphens and underscores, and starts with a letter (line 17).",
      ],
      [
        SV29("web", "uploads"),
        "web, volumes.uploads: use an absolute path in the container, such as /data. A folder of the server cannot be mounted from settings.",
      ],
      [SV30("web"), "web, volumes: two volumes are mounted at the same path."],
      [SV31("web"), "web, volumes: at most 16 volumes."],
      [
        SV32,
        "services: they read more than 256 secrets, more than one deploy carries.",
      ],
      [
        SV33,
        "services: they turn into Compose text larger than the 256 KiB a deploy carries.",
      ],
    ]
    for (const [placeRule, sentence] of cases)
      expect(said(placeRule)).toBe(sentence)
  })

  test("SL0 to SL4: two sentences each; the health check's and the domain's went with specs/015-domains-https (CL1)", () => {
    expect(laterSentences(F, "version")).toEqual([
      "zekno.app.json is written for a later version of zekno.",
      "Update zekno to use it.",
    ])
    expect(laterSentences(F, "build", "web")).toEqual([
      "zekno.app.json sets a build for web.",
      "Building from source is not in this version of zekno yet.",
    ])
    expect(laterSentences(F, "predeploy", "web")).toEqual([
      "zekno.app.json sets a pre-deploy command for web.",
      "A pre-deploy command is not in this version of zekno yet.",
    ])
    expect(laterSentences(F, "replicas", "web")).toEqual([
      "zekno.app.json sets replicas for web.",
      "Several copies of a service are not in this version of zekno yet.",
    ])
  })
})

describe("contracts/commands.md", () => {
  test("SH1 to SH3", () => {
    expect(SH1).toBe(
      "This folder has no settings file. Run zekno settings init to start one."
    )
    expect(SH2("compose.yaml")).toBe(
      "This folder deploys compose.yaml, a Compose file written by hand, so it has no settings to show."
    )
    expect(SH3("compose.yaml")).toBe(
      "This folder's zekno.json names compose.yaml, so zekno deploy uses it, not the zekno.app.json here."
    )
    // A zekno.json in a folder above names its folder (security review S1).
    expect(SH3("~/app/zekno.app.json", "~/app")).toBe(
      "The zekno.json in ~/app names ~/app/zekno.app.json, so zekno deploy uses it, not the zekno.app.json here."
    )
  })

  test("SH4 names the file that is here: the settings file as before, or a Compose file written by hand (specs/012-templates, security review T4)", () => {
    expect(SH4("deploy/zekno.app.json")).toBe(
      "This folder's zekno.json names deploy/zekno.app.json and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys deploy/zekno.app.json, not the zekno.app.json here."
    )
    expect(SH4("~/app/zekno.app.json", "~/app")).toBe(
      "The zekno.json in ~/app names ~/app/zekno.app.json and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys ~/app/zekno.app.json, not the zekno.app.json here."
    )
    expect(SH4("deploy/zekno.app.json", undefined, "compose.yaml")).toBe(
      "This folder's zekno.json names deploy/zekno.app.json and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys deploy/zekno.app.json, not the compose.yaml here."
    )
    expect(SH4("~/app/zekno.app.json", "~/app", "compose.yaml")).toBe(
      "The zekno.json in ~/app names ~/app/zekno.app.json and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys ~/app/zekno.app.json, not the compose.yaml here."
    )
  })

  test("CS1 to CS17", () => {
    expect(CS1("set")).toBe(
      "Say which setting: `zekno settings set <service>.<setting> <value>`."
    )
    expect(CS1("unset")).toBe(
      "Say which setting: `zekno settings unset <service>.<setting>`."
    )
    expect(CS2).toBe(
      "Say the new value: `zekno settings set <service>.<setting> <value>`."
    )
    expect(CS4(F, "api", ["web", "worker"])).toBe(
      "zekno.app.json has no service api. Its services are web, worker."
    )
    // CS5 names the settings of specs/015-domains-https (CL1); CS6 is a later setting's, replicas'.
    expect(CS5).toBe(
      "There is no such setting. The settings are image, start, restart, memory, cpus, health, health-timeout, port, publish, domains, secrets, plain.<NAME> and volumes.<name>."
    )
    expect(CS6("replicas")).toBe(
      "Several copies of a service are not in this version of zekno yet."
    )
    expect(CS6("build")).toBe(
      "Building from source is not in this version of zekno yet."
    )
    expect(
      CS7("That is not a memory limit.", "Use a size such as 512m or 1g.")
    ).toBe("That is not a memory limit. Use a size such as 512m or 1g.")
    expect(CS8("web", "memory limit", "1g")).toBe(
      "web · memory limit is 1g already. Nothing was written."
    )
    expect(CS9(F)).toBe(
      "Write this to zekno.app.json? Nothing is deployed until you deploy."
    )
    expect(CS10(F)).toBe(
      "There is no terminal to ask on. Add `--yes` to write it to zekno.app.json."
    )
    // The file a link names is named as the deploy names it (security review S1).
    expect(CS9("deploy/zekno.app.json")).toBe(
      "Write this to deploy/zekno.app.json? Nothing is deployed until you deploy."
    )
    expect(CS11).toEqual({
      text: "Written",
      detail: "Run zekno deploy to use it.",
    })
    expect(CS12(F)).toBe(
      "zekno.app.json changed since zekno read it, so nothing was written. Try again."
    )
    expect(CS13(F)).toBe(
      "zekno.app.json is a symbolic link. zekno changes it only as a file of its own."
    )
    expect(CS14(F)).toBe("Could not write zekno.app.json.")
    expect(CS15).toBe(
      "A service needs an image, so source.image cannot be unset."
    )
    expect(CS16("web", "memory limit")).toBe(
      "web · memory limit is not set. Nothing was written."
    )
    expect(
      CS17(
        "web, networking.publish",
        "set networking.port too, the port it reaches."
      )
    ).toBe(
      "That change cannot be written. web, networking.publish: set networking.port too, the port it reaches."
    )
  })

  test("CS4 with a name that broke its rule, and with one service (where the contract is silent)", () => {
    expect(CS4(F, undefined, ["web", "worker"])).toBe(
      "zekno.app.json has no such service. Its services are web, worker."
    )
    expect(CS4(F, "api", ["web"])).toBe(
      "zekno.app.json has no service api. Its service is web."
    )
  })

  test("IN1 to IN6", () => {
    expect(IN1).toBe("Image")
    expect(IN2).toBe("Service name")
    expect(IN3).toEqual({
      text: "Written zekno.app.json",
      detail: "Run zekno deploy to use it.",
    })
    expect(IN4).toBe(
      "There is already a zekno.app.json here. Change it with zekno settings set, or in an editor."
    )
    expect(IN5).toBe(
      "There is no terminal to ask on. Run zekno settings init at a terminal, or write zekno.app.json yourself."
    )
    expect(IN6).toBe(
      "This folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f <file>."
    )
    expect(IN1_RULE).toBe(
      "Use an image reference, such as ghcr.io/acme/web:1.4.2."
    )
    expect(IN2_RULE).toBe(
      "Use lowercase letters, digits and hyphens, starting with a letter."
    )
  })

  test("each setting's words", () => {
    const table: [Parameters<typeof settingWords>, string, string, string][] = [
      [
        ["image"],
        "image",
        "That is not an image reference.",
        "Use one such as ghcr.io/acme/web:1.4.2.",
      ],
      [
        ["start"],
        "start command",
        "That is not a start command zekno can run.",
        "Use a command, or leave start out to run the image's own.",
      ],
      [
        ["restart"],
        "restart rule",
        "That is not a restart rule.",
        "Use no, on-failure or always.",
      ],
      [
        ["memory"],
        "memory limit",
        "That is not a memory limit.",
        "Use a size such as 512m or 1g.",
      ],
      [
        ["cpus"],
        "processor limit",
        "That is not a processor limit.",
        "Use a number of processors, such as 0.5 or 2.",
      ],
      [["port"], "port", "That is not a port.", "Use a port from 1 to 65535."],
      [
        ["publish"],
        "published port",
        "That is not a port.",
        "Use a port from 1 to 65535.",
      ],
      [
        ["secrets"],
        "secrets",
        "That is not a list of secret names.",
        "A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.",
      ],
      [
        ["plain", "NODE_ENV"],
        "NODE_ENV",
        "That is not a value zekno can write.",
        "Use one line with no control character, at most 4096 characters.",
      ],
      [
        ["volume", "uploads"],
        "volume uploads",
        "That is not a mount path.",
        "Use an absolute path in the container, such as /data.",
      ],
    ]
    for (const [args, label, notA, rule] of table)
      expect(settingWords(...args)).toMatchObject({ label, notA, rule })
    expect(startRule("quote")).toBe("A quote does not close.")
  })

  test("the questions of the screen (contracts/app-screen.md, Words)", () => {
    expect(
      (
        [
          "image",
          "start",
          "restart",
          "memory",
          "cpus",
          "port",
          "publish",
          "secrets",
        ] as const
      ).map((key) => settingWords(key).question)
    ).toEqual([
      "Image",
      "Start command",
      "Restart rule",
      "Memory limit",
      "Processor limit",
      "Port",
      "Published port",
      "Secrets",
    ])
    expect(settingWords("plain", "NODE_ENV").question).toBe("NODE_ENV")
    expect(settingWords("volume", "uploads").question).toBe(
      "Mount path for uploads"
    )
  })
})

describe("contracts/deploy.md", () => {
  test("DP1, DP2, DP3, DP5", () => {
    expect(DP1.question).toBe("Deploy from which file?")
    expect(DP1.rows).toEqual([
      { label: "zekno.app.json", detail: "your settings" },
      { label: "compose.yaml", detail: "a Compose file written by hand" },
    ])
    expect(DP1.collapsed).toBe("From")
    expect(DP2).toBe(
      "This folder has zekno.app.json and compose.yaml. Say which with -f <file>."
    )
    expect(DP3.label).toBe("from")
    expect(DP3.detail(["web", "worker"])).toBe("2 services: web, worker")
    expect(DP3.detail(["web"])).toBe("1 service: web")
    expect(DP5).toBe(
      "This folder has zekno.app.json and compose.yaml. Run zekno link -f <file> here to say which."
    )
  })
})

describe("contracts/app-screen.md", () => {
  test("AS1 to AS7", () => {
    expect(AS1).toBe(
      "A change is written to the file. It runs after the next deploy."
    )
    expect(AS2).toBe("One app, one file: zekno.app.json")
    expect(AS3("512m")).toBe("! changed, not deployed (was 512m)")
    expect(AS3()).toBe("! changed, not deployed")
    expect(AS4).toBe("Change a setting")
    expect(AS5).toEqual({ now: "now", new: "new" })
    expect(AS6("demo", "prod")).toBe(
      "This folder is linked to demo on prod. Its settings are on that app's screen."
    )
    expect(AS7("web", "plain")).toBe(
      "Add one with `zekno settings set web.plain.<NAME> <value>`."
    )
    expect(AS7("web", "volume")).toBe(
      "Add one with `zekno settings set web.volumes.<name> <path>`."
    )
  })

  test("the words of a setting not set, and how values read", () => {
    expect(NOT_SET).toMatchObject({
      start: "the image's own",
      restart: "no",
      memory: "no limit",
      cpus: "no limit",
      port: "none",
      secrets: "none",
      plain: "none",
      volume: "none",
      publish: "not published",
    })
    expect(restartShown("on-failure")).toBe("on failure")
    expect(restartShown("always")).toBe("always")
    expect(restartShown("no")).toBe("no")
    expect(portShown(3000)).toBe("3000, not published")
    expect(portShown(3000, 8080)).toBe("3000, published on 8080")
    expect(words.IMAGE_NEEDED).toBe("A service needs an image.")
  })
})

test("no sentence holds an em dash or calls the runner an agent", () => {
  const texts: string[] = []
  const collect = (value: unknown): void => {
    if (typeof value === "string") texts.push(value)
    else if (typeof value === "function") {
      try {
        collect((value as (...args: unknown[]) => unknown)("x", "y", "z"))
      } catch {
        // A function that needs other arguments is checked through the tests above.
      }
    } else if (value && typeof value === "object")
      for (const inner of Object.values(value)) collect(inner)
  }
  collect(words)
  expect(texts.length).toBeGreaterThan(50)
  for (const text of texts) {
    expect(text).not.toContain("—")
    expect(text.toLowerCase()).not.toMatch(/\bagent\b/)
  }
})
