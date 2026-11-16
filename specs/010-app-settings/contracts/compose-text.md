# Compose Text Contract: what the settings turn into

User Story 4 (FR-009, FR-026, FR-027) and User Story 1. design.md leaves "the exact Compose text
each setting turns into" to the plan; this is it. The writer is `composeText(settings)` in
`apps/cli/src/settings/compose.ts`; reading it back for "changed, not deployed" is
`deployedSettings(text)` in the same file (research R4). The reasons for the form are research
R2.

## The rules

1. The text is YAML, written line by line by zekno, never by a YAML library. The same settings
   give the same bytes on every machine and every Bun version.
2. Two spaces of indent. Lines end with a line feed, the last one too. No empty line, no comment,
   no tab, no trailing space, no `name:` (the runner names the project `zekno-<app>`).
3. The keys Compose defines are written plain: `services`, `image`, `command`, `restart`,
   `mem_limit`, `cpus`, `expose`, `ports`, `environment`, `volumes`, `type`, `source`, `target`.
4. Every name from the settings (a service, a variable, a volume) and every string value is a
   YAML double-quoted scalar, escaped by `quote(s)`:
   - `\` is written `\\`, then `"` is written `\"`;
   - every `$` is written `$$`, which Compose reads as one literal `$`;
   - nothing else is changed: the settings hold no character that would need it (no `Cc`
     character, no U+2028, U+2029, U+FEFF, U+FFFE or U+FFFF; contracts/settings-file.md).
5. The one place the text asks Compose for a variable is a secret: `"NAME": "${NAME}"`, where
   `NAME` passed `SECRET_NAME`, at most 128 characters, and is not reserved. It holds no value;
   the runner gives Compose the value in its environment, as for any deploy.
6. The only plain number is `cpus`, written as JavaScript's `String(Number(text))` of the number
   held to `(0|[1-9][0-9]{0,3})(\.[0-9]{1,2})?`: `1`, `0.5`, `2.25`, never an exponent.
7. Services in the file's order; inside a service, the lines in the order of the table below,
   each only when its setting is set; plain variables after secrets, both in the file's order;
   volumes in the file's order. The top-level `volumes` lists each volume once, in the order it
   first appears, after every service; it is left out when no service has a volume.

## Each setting

`<q(x)>` is `quote(x)`. Indents are counted from the start of the line.

| Setting | Lines (in this order) |
|---|---|
| a service `<svc>` | `  <q(svc)>:` |
| `source.image` | `    image: <q(image)>` |
| `deploy.start` | `    command: [<q(word 1)>, <q(word 2)>, ...]`: the words of the start command (contracts/settings-file.md), joined with `, ` |
| `deploy.restart` | `    restart: <q(restart)>` |
| `deploy.memory` | `    mem_limit: <q(memory)>` |
| `deploy.cpus` | `    cpus: <number>` |
| `networking.port` with no `publish` | `    expose: [<q(port)>]` |
| `networking.port` and `publish` | `    ports: [<q(publish + ":" + port)>]` |
| `variables.secrets`, `variables.plain` | `    environment:` then, for each secret, `      <q(NAME)>: "${NAME}"`, then for each plain variable `      <q(NAME)>: <q(value)>` |
| `volumes` | `    volumes:` then, for each, `      - type: "volume"`, `        source: <q(vol)>`, `        target: <q(path)>` |
| at the end, when any service has a volume | `volumes:` then, for each volume once, `  <q(vol)>: {}` |

The first line of the text is `services:`.

Not set, a setting writes nothing, and Compose's own default applies: the image's command, no
restart (`no`), no memory or processor limit, no port recorded, no variable, no volume.

## The worked example: design.md's file

This settings file (design.md, "The file"; the board `SettingsFile`):

```json
{
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
```

turns into exactly this text, 594 bytes, SHA-256
`b2b84104158cddf3eeab5936aee8d42782fb96cf234a87cda3700c778747c11a`:

```yaml
services:
  "web":
    image: "ghcr.io/acme/demo-web:1.4.2"
    command: ["bun", "run", "start"]
    restart: "on-failure"
    mem_limit: "1g"
    cpus: 1
    expose: ["3000"]
    environment:
      "DATABASE_URL": "${DATABASE_URL}"
      "SESSION_KEY": "${SESSION_KEY}"
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
      "DATABASE_URL": "${DATABASE_URL}"
volumes:
  "uploads": {}
```

Checked on 2026-11-16 (research R2): `docker compose -p zekno-demo -f <this text> config` reads it
without error; `expectedValues` (`project/compose-file.ts`) gives `DATABASE_URL`, `SESSION_KEY`,
so a deploy asks for a value either lacks; the volume is the named volume `zekno-demo_uploads`.

## Escaping, case by case

| In the settings | In the Compose text | What Compose reads |
|---|---|---|
| plain `GREETING`: `say "hi"` | `"GREETING": "say \"hi\""` | `say "hi"` |
| plain `WIN`: `C:\temp` | `"WIN": "C:\\temp"` | `C:\temp` |
| plain `LITERAL`: `$HOME and ${X}` | `"LITERAL": "$$HOME and $${X}"` | `$HOME and ${X}` |
| plain `MONEY`: `$$` | `"MONEY": "$$$$"` | `$$` |
| plain `YAMLISH`: `a: b # c [d] {e} &f *g !h` | `"YAMLISH": "a: b # c [d] {e} &f *g !h"` | as written |
| plain `ANSWER`: `no` | `"ANSWER": "no"` | the text `no`, never false |
| plain `EMPTY`: (empty) | `"EMPTY": ""` | an empty value |
| start `sh -c 'echo $PORT'` | `command: ["sh", "-c", "echo $$PORT"]` | the words `sh`, `-c`, `echo $PORT` |
| a service named `true` | `  "true":` | the service `true` |
| secret `DATABASE_URL` | `"DATABASE_URL": "${DATABASE_URL}"` | the secret's value, from the runner's environment |

## Reading it back (`deployedSettings`)

For "changed, not deployed" only (research R4). The text of this machine's last deploy is read
with `Bun.YAML.parse`, after the checks `composeServices` makes (at most 256 KiB, at most 200
aliases), and each line above is mapped back: `command` to the start command (its words joined
with one space; a word that is empty or holds a space, a quote, a backslash or one of
`; & | < > ( ) $` and the backquote is put in double quotes, with `\` as `\\` and `"` as `\"`; so
the grammar of contracts/settings-file.md reads the same words back), `$$` to `$`, `"${NAME}"` to a secret, any other environment value to a plain variable. The result counts
only when `composeText` of it is exactly the text read; otherwise the last deploy was not made
from settings, and nothing is marked. It is never signed, sent or written.

## Tests

- The worked example: `composeText` of design.md's file is exactly the text above (bytes and
  SHA-256).
- Each row of "Each setting" alone, and every row of "Escaping, case by case": the line, and
  `Bun.YAML.parse` of the text giving what Compose reads (with `$$` as `$`).
- A thousand random settings within the rules (a seeded generator in the test): `composeText` is
  the same twice; `Bun.YAML.parse` of it gives back every name and value; `deployedSettings` of
  it gives back the same settings; every string from the settings appears only inside double
  quotes.
- `zekno settings compose` prints, and a deploy of the same file signs, the same bytes
  (FR-027; contracts/commands.md, "Tests").
- When `docker compose version` works on the machine running the tests, `docker compose config
  --quiet` reads the Compose text of every settings file of the test set without error; the test
  is skipped otherwise, as `test/scenarios/real-docker.test.ts` is. It contacts nothing.

## As built: after the security review (2026-11-16)

Written by the implementer of the review's fixes. Nothing in the text changes. Rule 4's "the
settings hold no character that would need it" holds as before; the start command and a plain
value now also hold no character drawn as nothing (contracts/settings-file.md, "As built", S2),
so what any surface shows of the text is the text. A last deploy made before this whose start
command held one is read back by `deployedSettings` as no settings (`composeText` of it throws,
which gives undefined), so nothing is marked against it; one whose plain value held one is read
back as before, and the value of the file differs from it, so it is marked.

## As built: after the second pass of the review (2026-11-16)

Written by the implementer (security review, part 7, S9). A text whose every line is one of the
lines of "Each setting" above, every name and value a double-quoted scalar escaped as `quote`
escapes (`inSettingsForm`, `project/compose-file.ts`), holds no YAML anchor, alias or tag,
whatever its values hold. Reading it back (`deployedSettings`), finding the values it expects
(`expectedValues`) and listing its services (`composeServices`) no longer count the `*` inside its
quoted values as aliases (`aliasesTooMany`), so a value of 500 asterisks keeps the marks and the
question for a missing secret. Any text in another form keeps the alias count exactly as before.
Tests: `test/project/compose-file.test.ts` and `test/settings/compose.test.ts`, "500 asterisks".
