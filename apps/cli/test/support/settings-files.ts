/**
 * The settings files every settings test reads (specs/010-app-settings,
 * tasks T004): design.md's file and the Compose text it turns into, good
 * files at the edges of each rule of contracts/settings-file.md, "Each
 * value", and one faulty file per sentence, each built so that one sentence
 * and no earlier one (by "The order of checks") applies. Where a faulty file
 * has a wrong place (a bad value, a key not known, a bad name, a comment),
 * it holds `SENTINEL` there, which no error may repeat.
 *
 * The expected sentences are copied from the contract, not from the code.
 * It is one list, longer than most files, on purpose: every settings test
 * reads the same set, and a sentence added to the contract adds a row here.
 */
import type { ServiceSettings, Settings } from "../../src/settings/types"

/** A marker that must never appear in any fault, message, stack or output. */
export const SENTINEL = "zk_SENTINEL_7c1e"

/** design.md's file, "The file", with its final line feed. */
export const DESIGN_FILE = `{
  "zekno": 1,
  "services": {
    "web": {
      "source": { "image": "ghcr.io/acme/demo-web:1.4.2" },
      "deploy": {
        "start": "bun run start",
        "restart": "on-failure",
        "memory": "1g",
        "cpus": 1
      },
      "networking": { "port": 3000 },
      "variables": {
        "secrets": ["DATABASE_URL", "SESSION_KEY"],
        "plain": { "NODE_ENV": "production" }
      },
      "volumes": { "uploads": "/data/uploads" }
    },
    "worker": {
      "source": { "image": "ghcr.io/acme/demo-worker:1.4.2" },
      "deploy": { "start": "bun run worker", "restart": "always" },
      "variables": { "secrets": ["DATABASE_URL"] }
    }
  }
}
`

/** The 594 bytes of contracts/compose-text.md, "The worked example". */
export const DESIGN_COMPOSE = `services:
  "web":
    image: "ghcr.io/acme/demo-web:1.4.2"
    command: ["bun", "run", "start"]
    restart: "on-failure"
    mem_limit: "1g"
    cpus: 1
    expose: ["3000"]
    environment:
      "DATABASE_URL": "\${DATABASE_URL}"
      "SESSION_KEY": "\${SESSION_KEY}"
      "NODE_ENV": "production"
    volumes:
      - type: "volume"
        source: "uploads"
        target: "/data/uploads"
  "worker":
    image: "ghcr.io/acme/demo-worker:1.4.2"
    command: ["bun", "run", "worker"]
    restart: "always"
    environment:
      "DATABASE_URL": "\${DATABASE_URL}"
volumes:
  "uploads": {}
`

/** The SHA-256 of `DESIGN_COMPOSE`, as contracts/compose-text.md and plan research R2 record it. */
export const DESIGN_COMPOSE_SHA256 =
  "b2b84104158cddf3eeab5936aee8d42782fb96cf234a87cda3700c778747c11a"

/** The settings of design.md's file, as data-model.md writes them. */
export const DESIGN_SETTINGS: Settings = {
  version: 1,
  services: [
    [
      "web",
      {
        image: "ghcr.io/acme/demo-web:1.4.2",
        start: "bun run start",
        restart: "on-failure",
        memory: "1g",
        cpus: "1",
        port: 3000,
        secrets: ["DATABASE_URL", "SESSION_KEY"],
        plain: [["NODE_ENV", "production"]],
        volumes: [["uploads", "/data/uploads"]],
      },
    ],
    [
      "worker",
      {
        image: "ghcr.io/acme/demo-worker:1.4.2",
        start: "bun run worker",
        restart: "always",
        secrets: ["DATABASE_URL"],
      },
    ],
  ],
}

/** One file of the set: its text (bytes for one that is not UTF-8), and the settings it gives or the exact sentence it stops with. */
export type SettingsCase = {
  name: string
  text: string | Uint8Array
  expect: { settings: Settings } | { fault: string }
}

const IMAGE = "ghcr.io/acme/web:1.4.2"
const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`

/** A file in the form `JSON.stringify` writes, two spaces in, with a final line feed. */
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** A file with the one service `web` (its image, then `sections`), and `more` services after it. */
const web = (
  sections: Record<string, unknown>,
  more: Record<string, unknown> = {}
): string =>
  json({
    zekno: 1,
    services: { web: { source: { image: IMAGE }, ...sections }, ...more },
  })

/** The settings of one service `web` with the image and `service`. */
const webSettings = (
  service: Partial<ServiceSettings> = {},
  more: [string, ServiceSettings][] = []
): Settings => ({
  version: 1,
  services: [["web", { image: IMAGE, ...service }], ...more],
})

/** The line (from 1) of the first `needle` in `text`. */
export function lineOf(text: string, needle: string, from = 0): number {
  const at = text.indexOf(needle, from)
  if (at === -1) throw new Error(`the test set has no ${needle} in its text`)
  return text.slice(0, at).split("\n").length
}

const FILE = "zekno.app.json"
/** A fault of form, said as `<file> could not be read as settings.` then the place and rule. */
const form = (said: string): { fault: string } => ({
  fault: `${FILE} could not be read as settings. ${said}`,
})
/** A later setting's two sentences. */
const later = (first: string, second: string): { fault: string } => ({
  fault: `${FILE} ${first} ${second}`,
})

const good = (
  name: string,
  text: string,
  settings: Settings
): SettingsCase => ({
  name,
  text,
  expect: { settings },
})

const names = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, at) => `${prefix}${at}`)

/** Good files: one per rule, at its edges, and the forms a file may take. */
const GOOD: SettingsCase[] = [
  good("design.md's file", DESIGN_FILE, DESIGN_SETTINGS),
  good(
    "the smallest file",
    json({ zekno: 1, services: { web: { source: { image: "nginx:1.27" } } } }),
    { version: 1, services: [["web", { image: "nginx:1.27" }]] }
  ),
  good(
    "every section empty",
    web({
      deploy: {},
      networking: {},
      variables: { secrets: [], plain: {} },
      volumes: {},
    }),
    webSettings()
  ),
  good("CRLF line ends", DESIGN_FILE.replace(/\n/g, "\r\n"), DESIGN_SETTINGS),
  good("a byte order mark", `\ufeff${DESIGN_FILE}`, DESIGN_SETTINGS),
  good(
    "keys in another order than zekno writes",
    `{"services":{"web":{"volumes":{"uploads":"/data/uploads"},"variables":{"plain":{"NODE_ENV":"production"},"secrets":["DATABASE_URL","SESSION_KEY"]},"networking":{"port":3000},"deploy":{"cpus":1,"memory":"1g","restart":"on-failure","start":"bun run start"},"source":{"image":"ghcr.io/acme/demo-web:1.4.2"}},"worker":{"variables":{"secrets":["DATABASE_URL"]},"deploy":{"restart":"always","start":"bun run worker"},"source":{"image":"ghcr.io/acme/demo-worker:1.4.2"}}},"zekno":1}`,
    DESIGN_SETTINGS
  ),
  good(
    "an image with a host and a port",
    web({}).replace(IMAGE, "localhost:5000/a/b:tag"),
    webSettings({ image: "localhost:5000/a/b:tag" })
  ),
  good(
    "an image on localhost",
    web({}).replace(IMAGE, "localhost/x"),
    webSettings({ image: "localhost/x" })
  ),
  good(
    "an image with a digest",
    web({}).replace(IMAGE, `ghcr.io/acme/web@${DIGEST}`),
    webSettings({ image: `ghcr.io/acme/web@${DIGEST}` })
  ),
  good(
    "an image with a tag and a digest",
    web({}).replace(IMAGE, `${IMAGE}@${DIGEST}`),
    webSettings({ image: `${IMAGE}@${DIGEST}` })
  ),
  (() => {
    const image = `a/${"b".repeat(253)}`
    return good(
      "an image of 255 characters",
      web({}).replace(IMAGE, image),
      webSettings({ image })
    )
  })(),
  (() => {
    const start = `${"a".repeat(2047)} ${"b".repeat(2048)}`
    return good(
      "a start command of 4096 characters",
      web({ deploy: { start } }),
      webSettings({ start })
    )
  })(),
  (() => {
    const start = Array.from({ length: 256 }, () => "w").join(" ")
    return good(
      "a start command of 256 words",
      web({ deploy: { start } }),
      webSettings({ start })
    )
  })(),
  good(
    "start commands with quotes and spaces",
    web(
      { deploy: { start: "sh -c 'echo $PORT && exit 0'" } },
      {
        api: {
          source: { image: IMAGE },
          deploy: { start: 'node -e "console.log(\\"hi\\")"' },
        },
        edge: {
          source: { image: IMAGE },
          deploy: { start: "  node   server.js  " },
        },
      }
    ),
    webSettings({ start: "sh -c 'echo $PORT && exit 0'" }, [
      ["api", { image: IMAGE, start: 'node -e "console.log(\\"hi\\")"' }],
      ["edge", { image: IMAGE, start: "  node   server.js  " }],
    ])
  ),
  good(
    "each restart rule",
    web(
      { deploy: { restart: "no" } },
      {
        api: { source: { image: IMAGE }, deploy: { restart: "on-failure" } },
        edge: { source: { image: IMAGE }, deploy: { restart: "always" } },
      }
    ),
    webSettings({ restart: "no" }, [
      ["api", { image: IMAGE, restart: "on-failure" }],
      ["edge", { image: IMAGE, restart: "always" }],
    ])
  ),
  good(
    "the least and the most memory and processors",
    web(
      { deploy: { memory: "6m", cpus: 0.01 } },
      {
        api: {
          source: { image: IMAGE },
          deploy: { memory: "99999g", cpus: 1024 },
        },
      }
    ),
    webSettings({ memory: "6m", cpus: "0.01" }, [
      ["api", { image: IMAGE, memory: "99999g", cpus: "1024" }],
    ])
  ),
  good(
    "a processor limit kept as written",
    `{"zekno":1,"services":{"web":{"source":{"image":"${IMAGE}"},"deploy":{"cpus":1.50}}}}`,
    webSettings({ cpus: "1.50" })
  ),
  good(
    "ports 1 and 65535",
    web(
      { networking: { port: 1, publish: 65535 } },
      {
        api: {
          source: { image: IMAGE },
          networking: { port: 65535, publish: 1 },
        },
      }
    ),
    webSettings({ port: 1, publish: 65535 }, [
      ["api", { image: IMAGE, port: 65535, publish: 1 }],
    ])
  ),
  (() => {
    const secrets = names(256, "S")
    return good(
      "256 secrets",
      web({ variables: { secrets } }),
      webSettings({ secrets })
    )
  })(),
  (() => {
    const secret = `A${"b".repeat(127)}`
    return good(
      "a secret name of 128 characters",
      web({ variables: { secrets: [secret] } }),
      webSettings({ secrets: [secret] })
    )
  })(),
  (() => {
    const plain = names(128, "V").map((name) => [name, "x"] as const)
    return good(
      "128 plain variables",
      web({ variables: { plain: Object.fromEntries(plain) } }),
      webSettings({ plain })
    )
  })(),
  (() => {
    const value = "v".repeat(4096)
    return good(
      "a plain value of 4096 characters",
      web({ variables: { plain: { LONG: value } } }),
      webSettings({ plain: [["LONG", value]] })
    )
  })(),
  good(
    "plain values of every kind, and reserved names as plain names",
    web({
      variables: {
        plain: {
          EMPTY: "",
          QUOTES: 'say "hi" \\ and $HOME ${X} $$',
          YAMLISH: "a: b # c [d] {e} &f *g !h | > ' % @ `",
          WORDS: "no",
          TEXT: "café, 東京, 🚀",
          PATH: "/usr/bin",
          DOCKER_HOST: "unix:///x",
        },
      },
    }),
    webSettings({
      plain: [
        ["EMPTY", ""],
        ["QUOTES", 'say "hi" \\ and $HOME ${X} $$'],
        ["YAMLISH", "a: b # c [d] {e} &f *g !h | > ' % @ `"],
        ["WORDS", "no"],
        ["TEXT", "café, 東京, 🚀"],
        ["PATH", "/usr/bin"],
        ["DOCKER_HOST", "unix:///x"],
      ],
    })
  ),
  (() => {
    const volumes = names(16, "v").map(
      (name) => [name, `/data/${name}`] as const
    )
    return good(
      "16 volumes",
      web({ volumes: Object.fromEntries(volumes) }),
      webSettings({ volumes })
    )
  })(),
  (() => {
    const volume = `v${"_".repeat(62)}`
    const path = `/${"p".repeat(254)}`
    return good(
      "a volume name of 63 and a mount path of 255 characters",
      web({ volumes: { [volume]: path } }),
      webSettings({ volumes: [[volume, path]] })
    )
  })(),
  good(
    "a mount path of every character allowed",
    web({ volumes: { data: "/var/lib/app_1.2@x+y-z" } }),
    webSettings({ volumes: [["data", "/var/lib/app_1.2@x+y-z"]] })
  ),
  (() => {
    const services = names(32, "s")
    return good(
      "32 services, one with a name of 63 characters",
      json({
        zekno: 1,
        services: Object.fromEntries(
          [...services.slice(1), `s${"-".repeat(61)}x`].map((name) => [
            name,
            { source: { image: IMAGE } },
          ])
        ),
      }),
      {
        version: 1,
        services: [...services.slice(1), `s${"-".repeat(61)}x`].map(
          (name) => [name, { image: IMAGE }] as const
        ),
      }
    )
  })(),
  good(
    "names a prototype has, and a service named true",
    json({
      zekno: 1,
      services: {
        constructor: {
          source: { image: IMAGE },
          variables: {
            plain: { __proto__: "a", constructor: "b", toString: "c" },
          },
          volumes: { constructor: "/a" },
        },
        true: { source: { image: IMAGE } },
      },
    }).replace(
      '"variables": {\n        "plain": {\n          "constructor"',
      '"variables": {\n        "plain": {\n          "__proto__": "a",\n          "constructor"'
    ),
    {
      version: 1,
      services: [
        [
          "constructor",
          {
            image: IMAGE,
            plain: [
              ["__proto__", "a"],
              ["constructor", "b"],
              ["toString", "c"],
            ],
            volumes: [["constructor", "/a"]],
          },
        ],
        ["true", { image: IMAGE }],
      ],
    }
  ),
]

const S = SENTINEL

/** A faulty file and its sentence. */
const bad = (
  name: string,
  text: string | Uint8Array,
  expect: { fault: string }
): SettingsCase => ({ name, text, expect })

/** Faulty files, one per sentence, in the order of the contract's sentences. */
function faulty(): SettingsCase[] {
  const cases: SettingsCase[] = []
  const add = (
    name: string,
    text: string | Uint8Array,
    expect: { fault: string }
  ) => cases.push(bad(name, text, expect))

  // Reading the bytes. SR1, SR2 and SR5 to SR9 are about the file, not its text: file.test.ts.
  const big = web({ deploy: { start: S } })
  add("65,537 bytes", big + " ".repeat(65_537 - Buffer.byteLength(big)), {
    fault: `${FILE} is larger than the 64 KiB a settings file may be.`,
  })
  add(
    "a byte that is not UTF-8",
    Uint8Array.from([
      ...Buffer.from(`{"zekno": 1, "${S}`),
      0xff,
      ...Buffer.from('": 1}'),
    ]),
    { fault: `${FILE} is not UTF-8 text.` }
  )

  // JSON (SJ1 to SJ5).
  const comment = `{\n  // ${S}\n  "zekno": 1\n}\n`
  add("a comment", comment, form("line 2: this is not JSON."))
  const twice = `{\n  "zekno": 1,\n  "services": {\n    "web": {\n      "source": { "image": "${IMAGE}" },\n      "deploy": { "memory": "${S}",\n        "memory": "${S}" }\n    }\n  }\n}\n`
  add(
    "a key twice inside deploy",
    twice,
    form("line 7: the same name as line 6.")
  )
  add(
    "nesting 7 deep",
    `{"zekno":1,"services":{"web":{"variables":{"plain":{"A":{"B":{"${S}":1}}}}}}}`,
    form("line 1: nested deeper than settings go.")
  )
  const long = web({ deploy: { start: `${S}${"a".repeat(4097 - S.length)}` } })
  add(
    "a string of 4,097 characters",
    long,
    form(`line ${lineOf(long, S)}: a text longer than 4096 characters.`)
  )
  add(
    "a top that is a list",
    `["${S}"]\n`,
    form("line 1: settings are one JSON object.")
  )

  // zekno (SV1, SL0).
  add(
    "zekno that is not a number",
    json({ zekno: S, services: {} }),
    form("zekno: use 1, the version of settings this zekno reads.")
  )
  add(
    '"zekno": 2, with other faults after it',
    json({ zekno: 2, [S]: 1, services: { [S]: S } }),
    later("is written for a later version of zekno.", "Update zekno to use it.")
  )

  // Keys this zekno does not know (SV6), and later settings (SL1 to SL5).
  const unknownSection = web({ deploy: { [S]: 1 } })
  add(
    "a key not known in a section",
    unknownSection,
    form(
      `web, deploy: a setting this zekno does not know (line ${lineOf(unknownSection, S)}).`
    )
  )
  const envFile = web({ env_file: ".env" })
  add(
    '"env_file": ".env" in a service',
    envFile,
    form(
      `web: a setting this zekno does not know (line ${lineOf(envFile, "env_file")}).`
    )
  )
  const include = json({
    zekno: 1,
    include: ["x.yaml"],
    services: { web: { source: { image: IMAGE } } },
  })
  add(
    '"include": ["x.yaml"] at the top',
    include,
    form(
      `A setting this zekno does not know (line ${lineOf(include, "include")}).`
    )
  )
  add(
    '"build": {"context": "../.."}',
    web({}).replace(
      `"image": "${IMAGE}"`,
      `"image": "${IMAGE}",\n        "build": { "context": "../.." }`
    ),
    later(
      "sets a build for web.",
      "Building from source is not in this version of zekno yet."
    )
  )
  add(
    "a pre-deploy command",
    web({ deploy: { predeploy: S } }),
    later(
      "sets a pre-deploy command for web.",
      "A pre-deploy command is not in this version of zekno yet."
    )
  )
  // A health check and a domain are settings since specs/015-domains-https (CL1): these are held to their rules.
  add(
    "a health check whose path breaks its rule",
    web({ deploy: { healthcheck: { path: S } } }),
    form(
      "web, deploy.healthcheck.path: use a path such as /health: no space and no #, at most 1024 characters."
    )
  )
  add(
    "replicas",
    web({ deploy: { replicas: 3 } }),
    later(
      "sets replicas for web.",
      "Several copies of a service are not in this version of zekno yet."
    )
  )
  const badDomain = web({ networking: { domains: [S] } })
  add(
    "a domain that breaks its rule",
    badDomain,
    form(
      `web, networking.domains: use a full name such as shop.example.com: no wildcard, no address, no port (line ${lineOf(badDomain, S)}).`
    )
  )

  // Each value (SV2 to SV31).
  add(
    "no service",
    json({ zekno: 1, services: {} }),
    form('services: name at least one service, such as "web".')
  )
  add(
    "33 services",
    json({
      zekno: 1,
      services: Object.fromEntries(
        names(33, "s").map((name) => [name, { source: { image: IMAGE } }])
      ),
    }),
    form("services: at most 32 services.")
  )
  const badName = json({
    zekno: 1,
    services: { [S]: { source: { image: IMAGE } } },
  })
  add(
    "a service name that breaks its rule",
    badName,
    form(
      `services: a service name is lowercase letters, digits and hyphens, and starts with a letter (line ${lineOf(badName, S)}).`
    )
  )
  add(
    "a service that is not an object",
    json({ zekno: 1, services: { web: S } }),
    form("web: use an object of sections.")
  )
  add(
    "a section that is not an object",
    web({ deploy: [S] }),
    form("web, deploy: use an object.")
  )
  add(
    "a service with no image",
    json({ zekno: 1, services: { web: { deploy: { start: S } } } }),
    form(
      "web, source.image: a service needs an image, such as ghcr.io/acme/web:1.4.2."
    )
  )
  add(
    "an image that is not a reference",
    web({}).replace(IMAGE, S),
    form(
      "web, source.image: use an image reference, such as ghcr.io/acme/web:1.4.2."
    )
  )
  add(
    '" " in a start command',
    web({ deploy: { start: " " } }),
    form(
      "web, deploy.start: use a command, or leave start out to run the image's own."
    )
  )
  add(
    `"start": "echo 'it"`,
    web({ deploy: { start: `echo '${S}` } }),
    form("web, deploy.start: a quote does not close.")
  )
  add(
    '"start": "a && b"',
    web({ deploy: { start: `${S} && b` } }),
    form(
      "web, deploy.start: it runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c."
    )
  )
  add(
    "a start command of 257 words",
    web({
      deploy: {
        start: [S, ...Array.from({ length: 256 }, () => "w")].join(" "),
      },
    }),
    form("web, deploy.start: use at most 4096 characters and 256 words.")
  )
  add(
    "a start command with a tab",
    web({ deploy: { start: `${S}\tb` } }),
    form("web, deploy.start: use one line with no control character.")
  )
  add(
    "a start command that is not a string",
    web({ deploy: { start: [S] } }),
    form('web, deploy.start: use a command in quotes, such as "bun run start".')
  )
  add(
    "a restart rule not known",
    web({ deploy: { restart: S } }),
    form("web, deploy.restart: use no, on-failure or always.")
  )
  add(
    "a memory limit not known",
    web({ deploy: { memory: S } }),
    form("web, deploy.memory: use a size such as 512m or 1g.")
  )
  add(
    '"cpus": 1e2',
    `{"zekno":1,"services":{"web":{"source":{"image":"${IMAGE}"},"deploy":{"cpus":1e2}}}}`,
    form("web, deploy.cpus: use a number of processors, such as 0.5 or 2.")
  )
  add(
    '"port": 3000.5',
    `{"zekno":1,"services":{"web":{"source":{"image":"${IMAGE}"},"networking":{"port":3000.5}}}}`,
    form("web, networking.port: use a port from 1 to 65535.")
  )
  add(
    "a published port of 65536",
    web({ networking: { port: 80, publish: 65536 } }),
    form("web, networking.publish: use a port from 1 to 65535.")
  )
  add(
    "secrets that are not a list",
    web({ variables: { secrets: S } }),
    form(
      'web, variables.secrets: use a list of names, such as ["DATABASE_URL"].'
    )
  )
  const badSecret = web({ variables: { secrets: ["A", `${S}-x`] } })
  add(
    "a secret name that breaks its rule",
    badSecret,
    form(
      `web, variables.secrets: a secret name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line ${lineOf(badSecret, S)}).`
    )
  )
  add(
    "a secret PATH",
    web({ variables: { secrets: ["PATH"] } }),
    form("web, variables.secrets: PATH is a name zekno keeps for itself.")
  )
  const twiceSecret = web({
    variables: { secrets: ["DATABASE_URL", "A", "DATABASE_URL"] },
  })
  add(
    "DATABASE_URL twice in secrets",
    twiceSecret,
    form(
      `web, variables.secrets: a name is there twice (line ${lineOf(twiceSecret, "DATABASE_URL", twiceSecret.indexOf("DATABASE_URL") + 1)}).`
    )
  )
  add(
    "257 secrets",
    web({ variables: { secrets: names(257, "S") } }),
    form("web, variables.secrets: at most 256 names.")
  )
  add(
    "plain variables that are not an object",
    web({ variables: { plain: [S] } }),
    form(
      'web, variables.plain: use an object of names and values, such as { "NODE_ENV": "production" }.'
    )
  )
  const badPlain = web({ variables: { plain: { [`${S}-x`]: "a" } } })
  add(
    "a plain variable's name that breaks its rule",
    badPlain,
    form(
      `web, variables.plain: a variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line ${lineOf(badPlain, S)}).`
    )
  )
  const plainRule =
    "use a value in quotes, one line with no control character, at most 4096 characters."
  add(
    '"\\ud800" in a plain value',
    web({}).replace(
      `"image": "${IMAGE}"\n      }`,
      `"image": "${IMAGE}"\n      },\n      "variables": { "plain": { "A": "${S}\\ud800" } }`
    ),
    form(`web, variables.plain.A: ${plainRule}`)
  )
  add(
    '"\\u0000" in a value',
    web({}).replace(
      `"image": "${IMAGE}"\n      }`,
      `"image": "${IMAGE}"\n      },\n      "variables": { "plain": { "A": "${S}\\u0000" } }`
    ),
    form(`web, variables.plain.A: ${plainRule}`)
  )
  add(
    "a line break in a plain value",
    web({ variables: { plain: { A: `${S}\nB` } } }),
    form(`web, variables.plain.A: ${plainRule}`)
  )
  add(
    "U+2028 in a plain value",
    web({ variables: { plain: { A: `${S}\u2028` } } }),
    form(`web, variables.plain.A: ${plainRule}`)
  )
  add(
    "a plain value that is not a string",
    web({ variables: { plain: { A: 5 } } }),
    form(`web, variables.plain.A: ${plainRule}`)
  )
  add(
    "129 plain variables",
    web({
      variables: {
        plain: Object.fromEntries(names(129, "V").map((name) => [name, "x"])),
      },
    }),
    form("web, variables.plain: at most 128 variables.")
  )
  add(
    "volumes that are not an object",
    web({ volumes: [S] }),
    form(
      'web, volumes: use an object of volume names and mount paths, such as { "data": "/data" }.'
    )
  )
  const badVolume = web({ volumes: { "../etc": "/x" } })
  add(
    '"volumes": {"../etc": "/x"}',
    badVolume,
    form(
      `web, volumes: a volume name is lowercase letters, digits, hyphens and underscores, and starts with a letter (line ${lineOf(badVolume, "../etc")}).`
    )
  )
  const mountRule =
    "use an absolute path in the container, such as /data. A folder of the server cannot be mounted from settings."
  add(
    '"volumes": {"data": "/srv/data:/data"}',
    web({ volumes: { data: "/srv/data:/data" } }),
    form(`web, volumes.data: ${mountRule}`)
  )
  add(
    "a mount path with a .. part",
    web({ volumes: { data: `/a/../${S}` } }),
    form(`web, volumes.data: ${mountRule}`)
  )
  add(
    "a relative mount path",
    web({ volumes: { data: S } }),
    form(`web, volumes.data: ${mountRule}`)
  )
  add(
    "17 volumes",
    web({
      volumes: Object.fromEntries(
        names(17, "v").map((name) => [name, `/${name}`])
      ),
    }),
    form("web, volumes: at most 16 volumes.")
  )

  // Rules across settings (SV15, SV16, SV25, SV30, SV32).
  add(
    "publish without port",
    web({ networking: { publish: 8080 } }),
    form(
      "web, networking.publish: set networking.port too, the port it reaches."
    )
  )
  add(
    "two services publishing 80",
    web(
      { networking: { port: 3000, publish: 80 } },
      {
        worker: {
          source: { image: IMAGE },
          networking: { port: 3001, publish: 80 },
        },
      }
    ),
    form("worker, networking.publish: web publishes the same port.")
  )
  add(
    "a plain variable that is also a secret",
    web({
      variables: { secrets: ["DATABASE_URL"], plain: { DATABASE_URL: S } },
    }),
    form(
      "web, variables.plain.DATABASE_URL: it is a secret of web too. Keep it in one place."
    )
  )
  add(
    "two volumes at one path",
    web({ volumes: { a: "/data", b: "/data" } }),
    form("web, volumes: two volumes are mounted at the same path.")
  )
  add(
    "more than 256 secrets across the services",
    web(
      { variables: { secrets: names(200, "A") } },
      {
        worker: {
          source: { image: IMAGE },
          variables: { secrets: names(200, "B") },
        },
      }
    ),
    form(
      "services: they read more than 256 secrets, more than one deploy carries."
    )
  )
  return cases
}

/** The whole test set: the good files, then the faulty ones. */
export const FILES: SettingsCase[] = [...GOOD, ...faulty()]

/** The good files only, with their settings. */
export const GOOD_FILES = FILES.filter(
  (
    file
  ): file is SettingsCase & { text: string; expect: { settings: Settings } } =>
    "settings" in file.expect && typeof file.text === "string"
)

/** The faulty files only. */
export const FAULTY_FILES = FILES.filter(
  (file): file is SettingsCase & { expect: { fault: string } } =>
    "fault" in file.expect
)
