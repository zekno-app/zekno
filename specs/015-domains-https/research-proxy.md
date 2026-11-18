# Research: which reverse proxy (for feature 015, domains and HTTPS)

Kept here ahead of the feature's spec so it is not lost. Read on 2026-11-18 from each project's current documentation and source; **nothing was run**. The choice was the maintainer's.

## Decision (maintainer, 2026-11-18)

**Caddy.** It is the only candidate whose whole configuration is one generated file that can be checked before it is loaded (`caddy validate`), which is what the deploy design asks for (specs/010-app-settings/deploy-v2.md, part 4.2: "The proxy's configuration is built, never pasted").

Decided with it: deploys with no dropped requests are not in the first version; Zekno never changes a person's DNS, it says which record to create and checks it before asking for a certificate.

## Versions read

Caddy 2.11.9 (2026-11-05), kamal-proxy 0.10.3 (2026-11-16), Traefik 3.7.19 (2026-11-13).

## The five things the design asks of a proxy

| Requirement | Caddy | kamal-proxy | Traefik |
|---|---|---|---|
| Config generated and checked as a whole | Yes: one JSON file, `caddy validate` | No: commands per service, no file, no check | Partly: one file, no check command |
| An alias resolved when it connects | Yes, from the source (idle connections kept 2 minutes) | Yes, from the source (idle connections never time out) | Yes, from the source (kept 90 seconds) |
| No Docker socket | Yes | Yes (driven by `docker exec`) | Yes (file provider) |
| Admin interface off, or out of reach of app networks | Yes: the container's own loopback, or a unix socket; off with reload by `SIGUSR1` since 2.11 | Yes: a unix socket | Yes: off by default |
| Certificates only for configured domains | Yes | Yes | Yes |

The second row comes from reading code, not from a test, and no project documents it. **The first step of 015's plan is a test on Docker on Linux**: restart a container behind an alias and see that the proxy follows it (the design's D13 and D14 again, with the proxy in place).

## What to carry into 015's plan (Caddy)

- **Reloads are not fully graceful today.** Open reports: a reload closes some newly accepted HTTP/1.1 connections (caddyserver/caddy#8233), the grace period is cancelled at once on reload (#8078), handler modules are cleaned up while requests run (#8143), and a reload can hang and take the admin API down (#8231). A reload happens only when routes or aliases change; measure it.
- **Reload without the admin API**: since 2.11, `SIGUSR1` reloads from the file given to `caddy run --config`, provided the config was never changed through the API. The docs still say `admin off` makes changes impossible without a restart.
- **Every config change aborts certificate work in progress.** Do not reload in a loop.
- **Certificates**: obtained in the background for hostnames in the config; HTTP-01 and TLS-ALPN-01 both on; HTTP redirected to HTTPS by default; storage under `/data/caddy` (one volume holds certificates, keys and the account). An account email is optional; without one only Let's Encrypt is used. On failure it retries with growing waits, up to a day apart, for up to 30 days, and uses Let's Encrypt's staging server while it retries.
- **The image runs as root** and the binary has the capability to bind low ports. Docker lets any user in a container with its own network bind ports 80 and 443; rootless Docker needs a host setting for ports below 1024.
- **HTTP/3 is on by default**, so UDP 443 would have to be published, or HTTP/3 turned off.
- **`dynamic a` upstreams cache lookups for a minute** and skip active health checks: use plain upstreams.
- **New upstreams start out healthy**, so a later no-dropped-requests switch cannot lean on health checks alone.
- Security advisories, November 2024 to November 2026: 23, all in 2026 against 2.11.x, mostly in parts this design does not use (file server, FastCGI, forward auth). Two concerned the admin API, one hop-by-hop headers. The image is pinned by digest in the runner, so each fix is a runner release.
- Image: `caddy:2.11.9-alpine`, amd64 and arm64, about 23 MB compressed.

## Why not the others

- **kamal-proxy**: the best at switching containers with no dropped requests (health check, switch, drain), but only through its own commands. No configuration file and no check; its state file is rewritten non-atomically; one service that fails to load wipes the whole routing table at restart (basecamp/kamal-proxy#233, open); a certificate is requested when the first visitor arrives, with no backoff; pre-1.0.
- **Traefik**: no command that checks a configuration; every dynamic file is run through a template engine, so `{{` in generated text is executed; it contacts its maker's servers by default (`checkNewVersion`); a failed certificate is not retried until the next change; 77 advisories in the same two years; the largest image.
