# Design: App settings

**Status**: proposed on 2026-11-16, not approved. Nothing here is built until the maintainer
approves it (spec FR-035). The boards are in [design/](./design/) and on the design canvas, in
the row "App settings (spec 010)".

## Decisions for the maintainer

Each has options and a recommendation. They are tool and design choices, so none is made.

### 1. The form of the file

| Option | For | Against |
|---|---|---|
| **JSON** (recommended) | The form `zekno.json` already has. Read strictly with what the CLI already uses, no new tool. The settings screen can rewrite it exactly, in a fixed key order. | No comments. |
| TOML | Comments. Familiar from `railway.toml` and `fly.toml`. Bun reads it. | Bun does not write it, and a change made from the settings screen would lose the person's comments and layout unless a tool that keeps them is added. |
| YAML | The form of a Compose file. Bun reads and writes it. | Loose by nature (many ways to write one value), and comments are lost on rewrite. |
| TypeScript | What Railway is moving to. | The file would be code that runs on the developer's machine at deploy time. A cloned repository's settings must never run anything there. Ruled out by the threat model. |

### 2. The name of the file, and whether it is `zekno.json`

Recommended: a file of its own, **`zekno.app.json`**. `zekno.json` is a signed statement by a
member (this folder deploys this app to this server), checked against the team and asked about
on first use. Settings are a different kind of thing: content of the project that the person
deploying signs as Compose text at deploy time, as a Compose file is. Mixing them would put
unsigned settings inside a signed statement.

### 3. Which file a deploy uses

1. `-f <file>`, either kind.
2. The file this folder's link (`zekno.json`) names.
3. The one that exists, when only one does.
4. With both and nothing above: a question at a terminal, a stop in a script.

Neither file is ever picked silently over the other.

### 4. The commands

| Command | Does |
|---|---|
| `zekno settings` | Shows the settings in sections. `--json`, and plain lines when piped. |
| `zekno settings set <service>.<setting> <value>` | Changes one. Shows old and new, asks once. `--yes` with no terminal. |
| `zekno settings unset <service>.<setting>` | Removes one. |
| `zekno settings compose` | Prints the Compose text the settings turn into. |
| `zekno settings init` | Starts a file by asking for the image and the service's name. |

### 5. The key that opens the settings screen

On an app's screen `s` already sets a secret. Recommended: **`e`** ("settings" in the hint
line, as in edit). The settings screen's own keys: `↑↓` move, `enter` change, `tab` services,
`c` Compose text, `d` deploy, `esc` back.

### 6. What a volume can be

Recommended: a named volume only. A folder of the server can be mounted only through a
hand-written Compose file, so a settings file from someone else's repository cannot reach the
server's own files.

## The file

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

The sections of the file are the sections of the screen.

| Section | Setting | Now | Meaning |
|---|---|---|---|
| `source` | `image` | yes | The image the service runs. |
| | `build` | later (C1) | Build from this folder: root directory, Dockerfile, build command. |
| `deploy` | `start` | yes | The start command. Left out: the image's own. |
| | `restart` | yes | `no`, `on-failure`, `always`. |
| | `memory`, `cpus` | yes | Limits. A size such as `512m` or `1g`; a number of processors. |
| | `predeploy` | later | A command run before the new version starts, such as a migration. |
| | `healthcheck` | later (C3) | A path that must answer before the deploy counts as done. |
| | `replicas` | later | Several copies, behind the proxy. |
| `networking` | `port` | yes | The port the service listens on. |
| | `publish` | yes | A port of the server that reaches it. Left out: not published. |
| | `domains` | later (C3) | Domains with HTTPS. |
| `variables` | `secrets` | yes | Names of secrets the service reads. Never a value. |
| | `plain` | yes | Values that are not secret. |
| `volumes` | `<name>: <path>` | yes | A named volume and where it is mounted. |

A file that uses a "later" setting is refused by this version with one sentence that names it.
A file written today stays valid when they arrive.

## The words

| Where | Line |
|---|---|
| Deploy summary, new line | `from     zekno.app.json  2 services: web, worker` |
| Both files, at a terminal | `? Deploy from which file?` then `zekno.app.json  your settings` and `compose.yaml  a Compose file written by hand` |
| Both files, no terminal | `This folder has zekno.app.json and compose.yaml. Say which with -f <file>.` |
| A later setting | `zekno.app.json sets a domain for web.` then `Domains are not in this version of zekno yet.` |
| Not in the right form | `zekno.app.json could not be read as settings.` then the place and the rule, such as `web, deploy.memory: use a size such as 512m or 1g.` |
| A field not known | the same first sentence, then `web, deploy: a setting this zekno does not know (line 9).` |
| No settings file | `This folder has no settings file. Run zekno settings init to start one.` |
| Before a change | `web · memory limit   512m → 1g` then `? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)` |
| After a change | `✔ Written  Run zekno deploy to use it.` |
| A value not allowed | `That is not a memory limit.` then `Use a size such as 512m or 1g.` |
| Changed and not deployed | `! changed, not deployed (was 512m)` beside the value |
| Foot of the settings screen | `A change is written to the file. It runs after the next deploy.` |

## Not in this design yet

- The settings screen at 80 columns, and on a light terminal. They follow the approved look once
  the wide boards are approved.
- The exact Compose text each setting turns into. It is a contract of the plan, with a test that
  the text printed equals the text signed.
- The second version of the deploy message (spec FR-032 to FR-034). It is written and reviewed
  as part of this feature, after these boards are approved.
