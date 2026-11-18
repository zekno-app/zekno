# Contract: the runner's stored state

FR-031, FR-032, FR-034, FR-009, V21. The functions are in `packages/core/src/deploy/state.ts`; the
runner reads and writes `state.json` in `apps/runner/src/home/home.ts` and uses them in
`apps/runner/src/commands/commands.ts`.

## The shape

```ts
type StoredRunnerState = RunnerState & {
  readonly v: 2
  /** Each app's message format: 1 while it may still take version 1, 2 after its first version-2 deploy. */
  readonly formats: Readonly<Record<string, 1 | 2>>
}
```

`RunnerState` is today's (`serverId`, `team`, `lastSequence`, `secrets`), unchanged, moved to
`state.ts` with `RunnerStateSchema`, `initialRunnerState` and `parseRunnerState` (T001).

## The rules

- **ST1. Reading** (`readRunnerState(value: unknown): StoredRunnerState`; throws `CoreError`
  otherwise, which the runner answers `invalid_state`, never "nothing accepted yet"):
  - with an own field `v`: read strictly: `v` exactly `2`; `serverId`, `team`, `lastSequence`,
    `secrets` by `RunnerStateSchema`'s rules; `formats` a record of `APP_NAME` to `1 | 2`; no other
    field; the keys of `formats` exactly the keys of `lastSequence`. Anything else throws.
  - without `v`: read by `parseRunnerState` (today's strict schema), then migrated (ST2).
- **ST2. Migration**, in memory only: `formats[app] = 1` for every app whose `lastSequence` is 1 or
  more, `2` for one at 0; `v: 2`. Nothing is written by reading.
- **ST3. Setup** (`newRunnerState({ serverId, team })`): `initialRunnerState`'s fields with `v: 2`
  and `formats: {}`. Written by `setup`, so a runner set up by this feature takes no version-1
  deploy at all.
- **ST4. Every write is whole.** `setup`, `sync`, `apply` and `deploy` write the whole
  `StoredRunnerState` with its mark through `writeState`; no write removes the mark or a part
  (FR-032). `sync` and the K3 save replace only `team`.
- **ST5. The version-1 path** (`afterVersionOneDeploy(state, next: RunnerState)`): returns `state`
  with `lastSequence` and `secrets` taken from `next` and every other part (`v`, `serverId`, `team`,
  `formats`) as it was (V21). `versionOneView(state)` gives the `RunnerState` part that
  `verifyDeploy` reads.
- **ST6. Who may take version 1** (`takesVersionOne(state, app)`): `formats[app] === 1`. An app with
  no entry (never held) or with `2` may not.
- **ST7. Record files.** For an app at format 2, every entry `"<app>/<NAME>"` with a hash has the
  file `records/<app>/<hash>.json` once a deploy of the app has completed its write; no other file
  is under `records/<app>/` after that write. Entries written by a version-1 deploy have no file.
  The state never names a missing file for an app at format 2.
- **ST8. Numbers are never dropped.** No function removes an app from `lastSequence` or `formats`
  (FR-009, V22).

## An older runner

- **ST9.** Runner 0.1.0 reads `state.json` with a strict schema that knows neither `v` nor
  `formats`, so once a runner of this feature has written, 0.1.0 answers every request that reads
  the state with `invalid_state` (`status`, `sync`, `apply`, `state`, `logs`), and its zekno says
  `The runner's stored state is damaged or incomplete, so it refuses to act.` It never reads the
  state as empty (FR-034, US4 scenario 5). `setup` answers `already_set_up` (the key exists).
- **ST10.** A runner of this feature reads a state runner 0.1.0 wrote (no `v`) and migrates it
  (ST2); until its first write the file is unchanged, so 0.1.0 put back before then still reads it.

## Tests

`packages/core/test/deploy/state.test.ts`: ST1 to ST6 and ST8, each rule with a state that breaks
only it. `apps/runner/test/scenarios/versions.test.ts`: ST3, ST4 (after `setup`, `sync`, `apply`,
`deploy` the file has `v: 2` and every part), ST5 (SC-007: a version-1 deploy on a marked state
keeps `v` and every app's format), ST6, ST10 (a `status` on an older state leaves its bytes as they
were). `apps/runner/test/scenarios/secrets-v2.test.ts`: ST7. `apps/runner/test/scenarios/pairing.test.ts`:
ST9 with runner 0.1.0 from git.
