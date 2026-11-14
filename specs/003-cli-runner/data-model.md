# Data Model: CLI and Runner

## On the developer's machine: the profile folder (`~/.zekno`)

| File | Content | Sensitive? |
|------|---------|-----------|
| `profile.json` | `{ memberName, keyName, rosters[], servers[] }` | No. Public keys and signed lists only |
| `secrets/<serverId>/<app>.json` | `{ records[], removals[] }` as the core defines them | No. Ciphertext and signatures |
| `history/<serverId>/<app>.json` | `[{ envelope, at, outcome }]`, the last 50 | No. Signed deploys, which contain the service definition |

`servers[]` entries: `{ name, serverId, target }` where `target` is `{ kind: "ssh", destination,
runnerPath }` or `{ kind: "local", home }`. A local target never stores a command to run.

`history` entries: `envelope` is the signed deploy as sent. Its number, app, server and service
definition are read from under the signature, never stored beside it. `outcome` is `sent`
(signed, no answer recorded), `started` or `start_failed`.

**Not sensitive does not mean trusted.** These files can be read by anyone without harm, but the
CLI does not believe them as they stand. There is no stored copy of the team's trust: every run
rebuilds it from `rosters[]`, starting from the team code in the keychain, and checks that each
entry in `servers[]` is in the signed list. Secret records and history entries are verified
against that trust each time they are used.

Rules: server names match `^[a-z0-9][a-z0-9-]{0,62}$` and are unique; `destination` matches
`^[A-Za-z0-9][A-Za-z0-9._@:-]*$`; `runnerPath` matches `^[A-Za-z0-9._/~-]+$`.

The signing key is not in this folder. It is in the OS keychain under service `app.zekno.cli`,
entry name `keyName`. The entry is `{ v: 1, secretKey, teamCode }`: the key, and the confirmation
code of the team's founding list, which is what the team lists on disk are checked against.

The folder is mode `0700` and its files `0600`.

## On the server: the runner's folder (`/var/lib/zekno`, mode 0700)

| File | Content | Mode |
|------|---------|------|
| `server.key` | The server's secret key, in the core's marked text form | 0600 |
| `state.json` | The core's `RunnerState` | 0600 |
| `apps/<app>/compose.yaml` | The service definition of the last accepted deploy | 0600 |
| `lock` | Present while a run is in progress | 0600 |

No decrypted secret is ever written here.

## Messages (defined in `packages/core/src/protocol.ts`)

| Message | From → to | Content |
|---------|-----------|---------|
| `RunnerSetupRequest` | CLI → runner | `{ founding, teamCode }` |
| `RunnerSetupResponse` | runner → CLI | `{ serverPublicKey, serverId, code }` |
| `RunnerSyncRequest` | CLI → runner | `{ rosters[] }` |
| `RunnerApplyRequest` | CLI → runner | `{ rosters[], deploy: { envelope, secrets[] } }` |
| `RunnerReport` | runner → CLI | `{ outcome, app?, sequence?, reason? }` |
| `RunnerStatus` | runner → CLI | `{ serverId, serverPublicKey, team: { teamId, version, hash }, lastSequence, secrets }` |

`RunnerReport.outcome`: `ok` (setup-free commands that only changed lists), `started`,
`start_failed`, `refused`. `reason` is one of the core's deploy or team-list refusal codes, or one
of the runner's own: `invalid_request`, `invalid_state`, `not_set_up`, `already_set_up`, `busy`.

`RunnerStatus.secrets`: `{ "app/NAME": { version, removed } }`.

## Reserved secret names

`PATH`, `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, `GODEBUG`, any name starting with `DOCKER_`,
`COMPOSE_`, `BUILDKIT_`, `BUILDX_`, `LD_`, `DYLD_` or `SSL_CERT_`, and any name ending in
`_PROXY`. Defined once, in the core (`isReservedSecretName`).
