# Quickstart: proving domains and HTTPS (feature 015)

How the feature is shown to work. Contracts: [core](./contracts/core.md), [runner](./contracts/runner.md), [CLI](./contracts/cli.md).

## On this machine, with no server

Prerequisites: Bun 1.4.4; for the gated set, Docker running and the image present (`docker pull caddy:2.11.9-alpine` once; the tests never pull).

```sh
bun run typecheck && bun run lint
cd packages/core && bun test
cd apps/runner && bun test            # the gated set says in one line whether it ran or why not
cd apps/cli && bun test && bun run screens --check
cd apps/web && bun test
```

What must be seen:

1. **A domain end to end, real Docker** (runner, gated): a deploy with a route answers `https://<domain>` through the proxy on a high port with a certificate for that domain from Caddy's internal authority; plain HTTP is redirected; nothing listens on 80 or 443 of this machine.
2. **One app holds a domain**: a second app's deploy naming it is refused `domain_taken`, uses no number, and the first still answers.
3. **A release**: a deploy without the domain stops the answer, and the certificate's folder is gone from the proxy's volume; the last release removes the proxy.
4. **A name is followed**: the routed container is restarted and the proxy reaches it again with no reload.
5. **A configuration that does not load** leaves the earlier one serving and the state unchanged; the outcome is `routes_failed`.
6. **The health check**: passes on 200, fails on 500 and on no answer within the limit with the app left running, follows no redirect.
7. **An app without either** makes exactly the Docker calls it made before.
8. **The CLI** (stand-ins for the resolver, the HTTPS request and the ssh host): every line of `design/lines.md` comes out word for word at a terminal, in the app and with no terminal; every stop signs nothing; the frozen plain scenes pass.
9. **Old and new programs**: a zekno of this feature stops before signing a deploy with a domain for a runner of protocol 3; a zekno of feature 014 stops before signing anything for a runner of protocol 4.

Afterwards: no container, network or volume named `zekno-*` made by the tests is left.

## Results

On 2026-11-19, on the development machine (macOS, Docker Desktop), at the last commit of `015-domains-https` before the merge into `dev`:

| Check | Result |
|---|---|
| `packages/core`: type check, lint, tests | 355 pass, 0 fail |
| `apps/runner`: type check, lint, format, tests | 328 pass, 1 skip (the gate for a real build), 0 fail |
| `apps/runner`: the gated set with real Docker and the pinned Caddy | 9 pass, inside the run above; nothing named `zekno-*` left in Docker afterwards |
| `apps/cli`: type check, lint, format, tests | 2,647 pass, 4 skip, 0 fail |
| `apps/cli`: the stored screens (`capture.ts --check`) | all in step |
| `apps/web`: tests, type check, lint | 54 pass, 0 fail |
| The compiled runner | answers `{"version":"0.1.0","protocol":4}` |
| Protected files | `e2e.config.ts`, `tests/`, `bun.lock`, every `package.json`, `runner-release.json` and the landing page unchanged; the frozen plain test gained four help lines in its list of added lines and nothing else |

By point of the list above:

1. to 6. The gated set: a deploy with a domain answers over HTTPS through the proxy with a certificate for that domain (Caddy's internal issuer); HTTP is redirected; a second app cannot take the domain; a container restarted behind its name is followed; a refused configuration leaves `caddy.json` byte for byte and the earlier one serving; a release deletes the certificate's folder, also with the proxy stopped; the health check passes, fails on 500 and on no answer, and follows no redirect.
7. An app without a route or a health check makes exactly the Docker calls it made before (runner), and no lookup, no `ssh -G`, no TLS connection and the same requests (CLI).
8. Every line of `design/lines.md` comes out word for word, except the four the walkthrough names (`design/walkthrough.md`; plan, "As built"); every stop signs nothing; the frozen plain scenes pass.
9. A zekno of this feature stops before signing a deploy with a domain for a runner below protocol 4; an older zekno stops before signing anything for a runner of protocol 4.

The security review (`security-review.md`): nothing critical or high; one medium, two low and five notes, each fixed with a test that failed first, or accepted and said in the docs.

Not proven here, and so part of the maintainer steps: a certificate from Let's Encrypt on ports 80 and 443, Docker on Linux, a real `ssh -G` against a real server, and a browser opening the address.

## Maintainer steps

Each is the maintainer's, with a go-ahead at the time. Nothing before M1 needs them.

| Step | What |
|---|---|
| M1 | Merge `015-domains-https` into `dev`, push `dev`. |
| M2 | Push the tag `runner-v0.1.1-dev.1` from `dev`; the workflow publishes a pre-release. |
| M3 | Run the second build on this machine and commit the checksums it writes to `runner-release.json` on `dev`. |
| M4 | Choose the server and the domain for the proof: ports 80 and 443 free on the server, a DNS record you can set. |
| M5 | The proof, each use of the server with a go-ahead: update the runner, `zekno domain add`, set the record, `zekno deploy`; a browser opens the address with no warning; `zekno rollback` and it still does; `zekno domain rm` and a deploy, and the server no longer answers; run the gated set's Linux questions (research R33); clean up. |
| M6 | Merge `dev` into `main`, push the tag `runner-v0.1.1`, approve the release in the `prod` environment. |
| M7 | Second build, commit the checksums on `main`. |
| M8 | Say whether the docs' first group keeps its new name. |
