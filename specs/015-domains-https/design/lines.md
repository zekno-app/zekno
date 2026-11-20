# The words of feature 015, domains and HTTPS

**Status**: approved on 2026-11-19 with the ten points decided as recommended. The boards draw these lines; where a board and this file differ, the board is used.

Example values: the app `shop`, its service `web` on port 3000, the server `prod-1` at 203.0.113.7, the domain `shop.example.com`, another app `blog`.

Habits kept from the lines that exist: the first sentence says what happened and the second what to do; "Nothing was signed." when zekno stopped before signing; a command to run in backticks, which a terminal and the app drop; a mark before every state, never colour alone.

## A. `zekno domain add` and `zekno domain rm`

They follow `zekno settings set`: the change line, the question, `✔ Written`.

| # | When | Line |
|---|---|---|
| A1 | The change, adding the first domain | `web · domains  none → shop.example.com` |
| A2 | The change, adding a second | `web · domains  shop.example.com → shop.example.com, www.example.com` |
| A3 | The question (today's) | `? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)` |
| A4 | Written (today's) | `✔ Written  Run zekno deploy to use it.` |
| A5 | After A4, the record to create | `Before you deploy, create this DNS record at your DNS provider:` then, on its own line, `A  shop.example.com  203.0.113.7` |
| A6 | After A4, when the server's public address is not known | `Before you deploy, point shop.example.com at the public address of prod-1 at your DNS provider.` |
| A7 | Several services have a port | `? Which service answers for shop.example.com?` and the list of services that have a port. Once answered it is drawn as every list question of zekno is, `✔ Service  web` (approved as built on 2026-11-19; the board kept the question with its answer after it) |
| A8 | The change, removing | `web · domains  shop.example.com → none` |
| A9 | Written, after a removal | `✔ Written  Run zekno deploy to release it.` |

Refused, with nothing written (exit status 2, as `zekno settings set` gives):

| # | When | First sentence | Second |
|---|---|---|---|
| A10 | Not a name zekno routes: a wildcard, an address, `localhost`, a port, a path, a special-use name | `*.example.com is not a domain zekno can route.` | `Use a full name such as shop.example.com: no wildcard, no address, no port.` |
| A11 | Letters outside ASCII, in either spelling (decided, point 8) | `bücher.example is not a domain zekno can route yet.` | `Names with letters other than a to z, digits and the hyphen are not in this version of zekno.` |
| A12 | The service has no port | `web has no port, so a domain cannot reach it.` | `Set the port it listens on first: zekno settings set web.port <port>.` |
| A13 | The domain is in the file already | `shop.example.com is already a domain of api.` | `A domain reaches one service. Remove it there first: zekno domain rm shop.example.com.` |
| A14 | A Compose file written by hand (decided, point 1) | `This folder deploys a Compose file written by hand.` | `Domains need a settings file. Run zekno settings init to start one.` |
| A15 | `rm` of a domain the file does not have | `shop.example.com is not a domain of this app.` | `Run zekno domain to see its domains.` |
| A16 | No terminal, several services, no `--service` | `There is no terminal to ask on.` | `Say which service with --service <name>.` |

## B. `zekno deploy` with a domain

| # | When | Line |
|---|---|---|
| B1 | A new domain points to the server, before the panel | `✔ shop.example.com points to prod-1  203.0.113.7` |
| B2 | The panel's new row, one domain a row | `domains   shop.example.com` |
| B3 | The panel, more than three domains | the first three, then `and 5 more` dim |
| B4 | While the deploy waits for HTTPS, live | `⠹ Waiting for the certificate of shop.example.com` and the seconds, dim |
| B5 | HTTPS answers with a valid certificate | `✔ https://shop.example.com is live  certificate until 17 Feb 2027` |
| B6 | It does not within the wait (a warning; the deploy started) | `! The certificate for shop.example.com is not ready yet. Run `zekno domain` to see when it is.` |

Stops before signing. At a terminal the sentence stands alone, as every stop at that point does; the app shows the panel with `✖ Checked`.

| # | When | Sentence |
|---|---|---|
| B7 | The domain has no record | `shop.example.com has no DNS record yet. Create an A record for shop.example.com with the value 203.0.113.7, then run `zekno deploy` again. Nothing was signed.` |
| B8 | It points elsewhere | `shop.example.com points to 198.51.100.9, not to prod-1. Change its A record to 203.0.113.7, then run `zekno deploy` again. If something of yours stands in front of prod-1, deploy with `--skip-dns-check`. Nothing was signed.` |
| B9 | Another app on the server holds it | `shop.example.com belongs to blog on prod-1. Release it there first: run `zekno domain rm shop.example.com` in blog's folder and deploy blog. Nothing was signed.` |
| B10 | The runner does not carry out routes | `The runner on prod-1 is version 0.1.0, too old for domains and health checks. Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed.` |
| B11 | A service with a domain has no port | `web has a domain and no port. Set the port it listens on with `zekno settings set web.port <port>`. Nothing was signed.` |
| B12 | A rollback whose old text lacks a routed service | `What deploy 41 ran has no service named web, which shop.example.com reaches. Remove the domain first, or roll back to a deploy that has web. Nothing was signed.` |

Warnings; the deploy goes on.

| # | When | Sentence |
|---|---|---|
| B13 | The server's public address is not known | `zekno cannot tell whether shop.example.com points to prod-1, because this machine reaches prod-1 at an address that is not public. It points to 203.0.113.7.` |
| B14 | `--skip-dns-check` | `DNS was not checked for shop.example.com.` |
| B15 | A domain the app holds already has moved away | `shop.example.com points to 198.51.100.9, no longer to prod-1. Visitors are not reaching shop there, and its certificate cannot be renewed.` |

After the deploy was accepted. The app is running; the number is used.

| # | When | Sentence |
|---|---|---|
| B16 | The proxy cannot start: a port is taken | `shop is running, but prod-1 cannot answer for its domains: port 80 is in use by another program. Free ports 80 and 443 on prod-1, then run `zekno deploy` again.` |
| B17 | A routed service has no container | `shop.example.com cannot reach web: no container of web is running. Run `zekno logs` to see why.` |
| B18 | A routed service uses the host's network | `shop.example.com cannot reach web: web uses the host's network, which zekno cannot route to. Give web a network of its own, then run `zekno deploy` again.` |
| B19 | The proxy did not take the new configuration | `shop is running, but prod-1 did not take its new domains, so it answers for the ones it had. Run `zekno doctor` to see why.` |
| B20 | The runner stopped waiting for `docker compose up` at its time limit (security review, lead A10; the report's `startLimit`, protocol 5). The app did not start, unlike B16 to B19, and the number is used. Said in place of today's line of a start that failed; the line about the number, the "Docker said" panel and what to run next stay. The limit is worded from the report's seconds: `30 minutes`, `1 minute`, or `90 seconds` when it is not whole minutes (`apps/cli/src/shared/start-limit.ts`). **Proposed 2026-11-20, not approved yet.** | At a terminal and in the app, the lead line: `prod-1 accepted deploy 42, but shop did not start within 30 minutes, so prod-1 stopped waiting.` In plain output: `Deploy 42 of shop was accepted by prod-1, but the app did not start within 30 minutes, so prod-1 stopped waiting. Check Docker on the server.` |

The runner's own refusal, in the pattern of feature 014's R-lines (no backticks; it cannot name the domain, since the runner answers one fixed word):

| # | Reason | Sentence |
|---|---|---|
| R9 | `domain_taken` | `A domain of this deploy belongs to another app on that server. Nothing of it ran. Run zekno domain to see which.` |
| R10 | `too_large`, for domains | `That server would hold more domains than a runner keeps. Nothing of this deploy ran. Remove a domain from an app there first.` |

## C. A health check

| # | When | Line |
|---|---|---|
| C1 | The stage row of a deploy with a health check: a fifth stage | `✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ✔ Healthy` |
| C2 | While it waits, live, under the stage row | `waiting for web to answer GET /health` and the seconds, dim |
| C3 | Not healthy in time, with a path | `web did not answer GET /health with success within 60 seconds. shop is running as deployed, and nothing was rolled back. Run `zekno logs` to see why, or `zekno rollback` to go back.` |
| C4 | Not healthy in time, without a path | `web did not stay up within 60 seconds. shop is running as deployed, and nothing was rolled back. Run `zekno logs` to see why, or `zekno rollback` to go back.` |
| C5 | In `zekno settings`, under Deploy | `health    GET /health, within 60s`, or `health    not set`. `not set` is drawn by the settings screen only: at a terminal `zekno settings` prints the settings that are set (approved as built on 2026-11-19) |
| C6 | In `zekno settings`, without a path | `health    stays up, within 60s` |

A deploy without a health check keeps today's four stages.

## D. `zekno domain`

One line a domain: the name, `service:port`, the state after its mark, and a detail, dim. The first line names the app and the server, as `zekno settings` names the app and the file.

| # | State | Mark | Detail |
|---|---|---|---|
| D1 | `live` | `●` green | `certificate until 17 Feb 2027` |
| D2 | `live` | `●` yellow | `certificate ends 21 Nov, renewal is failing` |
| D3 | `no certificate yet` | `●` yellow | `prod-1 is asking for one` |
| D4 | `no DNS record` | `●` red | `create an A record with the value 203.0.113.7` |
| D5 | `DNS points elsewhere` | `●` red | `198.51.100.9, not prod-1` |
| D6 | `not answering` | `●` red | `nothing answers on port 443 of prod-1` |
| D7 | `not deployed` | `○` dim | `run zekno deploy` |
| D8 | `to be released` | `○` dim | `removed from the file, run zekno deploy` |
| D9 | `belongs to blog` | `✖` red | `release it there first` |
| D10 | No domain at all | | `shop has no domain. Add one with zekno domain add <domain>.` |

With no terminal: one line a domain, tab-separated: the domain, the service, the port, the state in one word (`live`, `renewing`, `waiting`, `no-dns`, `dns-elsewhere`, `down`, `not-deployed`, `releasing`, `taken`), and the certificate's last day or nothing. `--json` gives the same.

## E. Where else domains show

| # | Where | Line |
|---|---|---|
| E1 | `zekno settings`, under Networking | `domains   shop.example.com`, one a row, or `domains   none`. `none` is drawn by the settings screen only, as C5's `not set` is (approved as built on 2026-11-19) |
| E2 | `zekno status`, after the app's line | `shop  https://shop.example.com` |
| E3 | `zekno doctor`, per server with a routed app | `✔ Proxy          answers for 2 domains` |
| E4 | `zekno doctor`, the proxy is not running | `✖ Proxy          not running` and under it `Deploy an app with a domain to start it again` |
| E5 | `zekno doctor`, a port is taken | `✖ Proxy          port 80 is in use by another program` and under it `Free ports 80 and 443 on prod-1` |
| E6 | The app, settings screen, under Networking | `domains    shop.example.com` |
| E7 | The app, an app's screen | a `Domains` box under `Secrets`: each domain and its state |
| E8 | The app, the deploy screen | the panel's `domains` row and, with a health check, the fifth stage |
