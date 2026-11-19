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

Filled in when the feature is built.

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
