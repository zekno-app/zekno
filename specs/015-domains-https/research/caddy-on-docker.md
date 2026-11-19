# Research record: Caddy 2.11.9 on Docker, run on 2026-11-19

The record of an Opus agent that ran every experiment below with real Docker (Docker Desktop for macOS, engine 29.6.1, arm64; not Linux on bare metal). Its scratch files were not kept. Decisions taken from it are in [research.md](../research.md).

## Short answer (under 500 words)

Caddy 2.11.9 does what the design asks: SIGUSR1 reloads with admin off, and the proxy follows an alias across container restarts (V23 closed). But the experiments turned up several traps the plan has to avoid. The worst: reloading with `docker kill -s USR1` switches off the proxy's restart policy. Everything ran on Docker Desktop for macOS (engine 29.6.1, arm64), not Linux.

1. **Image:** the tag exists.
   - Index `sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0`, amd64 `sha256:fc9cbc100585871d18d4e451cca7021785c90a7006087427ae5ceb3e4efe6424`, arm64 `sha256:9ee998103a2bc0d4392bbe9738b4069da1562d6920b3cd8088cfd098a8270120`.
   - About 23.6 MiB compressed (88 MB on disk). Runs as root.
   - Has busybox `wget` and `nc`, and also curl 8.23.0. It declares no `VOLUME`, so `/data` must be a named volume or certificates are lost.
2. **Config:** listen on `:443` only, `protocols: ["h1","h2"]` (no UDP socket), and an explicit `acme` issuer with the Let's Encrypt `ca` and `test_ca` (offline run: only Let's Encrypt was tried).
   - A server on both `:80` and `:443` served plain HTTP with no redirect.
   - `caddy validate`: exit 0 or 1, the error is a JSON line on stderr. It accepts a dial with no port, `{}` and a CA that is not a URL; `null` makes it panic (exit 2).
3. **Reload:** SIGUSR1 works with admin disabled, and a broken config keeps the old one serving.
   - Signal: the log line `successfully reloaded` or `failed to reload config from file`, then an `@id` nonce checked in `/config/caddy/autosave.json`.
   - An empty file reloads "successfully" and takes every site down.
   - Use `docker exec <proxy> kill -USR1 1`. `docker kill -s USR1` silently disables both `unless-stopped` and `always`.
4. **Aliases:** Caddy looks the alias up on every connection. When another container took the old address, it got 0 of 394 requests; the app came back on a new address and was served with no reload. Outages lasted only as long as Docker's restart back-off (0.16 s to 3.3 s). Docker gives up restarting a container if network setup fails.
5. **Networks:** connecting and disconnecting the proxy under load did not disturb other routes. But disconnecting a network that a loaded route still uses hung a request for 11.6 minutes. Load the config first, then disconnect.
6. **Port clash:** exit 125. stderr says `port is already allocated` (another container; with `-d` a `Created` container is left behind) or `address already in use` (a host process; this wording is Docker Desktop's).
7. **Certificates:** stored at `/data/caddy/certificates/<issuer>/<domain>/<domain>.{crt,key,json}`; the issuer folder for Let's Encrypt is `acme-v02.api.letsencrypt.org-directory`. Load the config without the domain, then `rm -rf` the folder. In the other order Caddy keeps serving from memory and gets a new certificate at restart.
8. **Health check:** use `curl -sS -o /dev/null --max-time 5 --max-filesize 1024 --proto '=http' -w '%{http_code}|%{exitcode}'`. Healthy means exit 0 or 63 and a code from 200 to 399; a status line followed by silence gives 200 with exit 28. busybox `wget` always follows redirects. Aliases must start with a letter: `000…1` and `0x7f000001` parse as IP addresses.
9. **TLS:** the certificate's SAN is the domain and the chain verifies. HTTP gets a 308 to https.
10. **Also:** start-up takes about 0.2 s. The default eternal grace period let a stuck request keep a SIGTERM'd proxy alive and serving nothing; set `apps.http.grace_period`. Each reload drops about 5 new HTTP/1.1 connections. Mount the config's directory, not the file.

**Against the design:** use `docker exec kill`, not `docker kill -s`; order disconnects after the reload; set a grace period; aliases start with a letter; never listen on both ports in one server.

**Cleanup:** every `zk015-*` container, network and volume is removed. The lists match the snapshot taken before; no other container was touched. The image `caddy:2.11.9-alpine` is still pulled.

---

# Caddy for feature 015: what was run and what it showed

Hands-on research, 2026-11-19, for specs/015-domains-https (design: specs/010-app-settings/deploy-v2.md parts 4.2 and 4.3).

**Machine.** Docker Desktop on macOS, engine 29.6.1, linux/arm64, kernel 6.12.76-linuxkit. **Not Linux on bare metal**: every result about Docker networking, port publishing and bind mounts comes with that caveat (see "Not verified").

**Rules kept.** Only `caddy:2.11.9-alpine` was pulled. All containers, networks and volumes were named `zk015-*` and all were removed at the end; the lists of containers, networks and volumes were compared with a snapshot taken before the work and are identical (`baseline-*.txt` and `final-*.txt`). Host ports used: 127.0.0.1:18080, 127.0.0.1:18443 and, for one test, 127.0.0.1:18081. No certificate authority was contacted: the internal issuer was used for every live test, and the Let's Encrypt config was only run with `--network none`, where it cannot reach anything. The pulled image `caddy:2.11.9-alpine` is still on the machine (88 MB on disk); remove it with `docker rmi caddy:2.11.9-alpine` if you don't want it.

Raw outputs are in the scratch folder: `q1-*`, `q2/`, `q3/`, `q4/`, `q5/`, `q6/`, `q7/`, `q8/`, `q9/`, `q10/`. Scripts are in `bin/` (`gen.py` config generator, `loop.sh`, `summ.py`, `reload-and-confirm.sh`), configs in `conf/` (`recommended-le.json`, `recommended-internal.json`, the broken configs, `app.json`).

## Summary: what contradicts or sharpens the design

1. **`docker kill -s USR1` turns off the proxy's restart policy.** Docker counts any `docker kill` as a manual stop. The Caddy image sets no stop signal, so after one `docker kill -s USR1` the next crash is **not** restarted, under `unless-stopped` **and** under `always`. Reload with **`docker exec <proxy> kill -USR1 1`** instead: it reloads the same way and leaves the restart policy alone (Q3, Q10).
2. **V23 is closed (on Docker Desktop).** The proxy looks the alias up each time it opens a connection. In the test another container took the restarted container's old address; the proxy never sent it a request. The app came back on a new address and the proxy reached it with no reload. While the container was down, every request got a 502 (Q4).
3. **Don't take the proxy off a route network while a route still points through it.** A request then reused a pooled connection over the removed interface and **hung for 11.6 minutes** (it ended only when the proxy was killed). Change the order: load the config without the route first, then disconnect. Joining a network goes the other way: connect first, then load the route (Q5).
4. **Set `apps.http.grace_period` (e.g. `"10s"`).** The default is an *eternal* grace period. With it, one stuck upstream request kept a SIGTERM'd Caddy alive, serving nothing, with no limit (we cut it at 12 s). The restart policy cannot help, because the process never exits. With `grace_period: "10s"`, Caddy exits after 10 s and the restart policy brings it back (Q10).
5. **An empty config file is accepted as a successful reload, and every site goes down.** Caddy logs "successfully reloaded config from file", stops all servers and opens the default admin endpoint on localhost:2019 inside the container. `caddy validate` does reject an empty file (exit 1), but accepts `{}`. The runner must validate the file and then confirm the result with a nonce (Q3).
6. **The health check should use `curl`, which is in the image.** busybox `wget` always follows redirects and has no way to turn that off. Healthy means curl's exit is 0 or 63 *and* `%{http_code}` is 200 to 399. A server that sends a status line and then stalls gives `http_code=200` with exit 28 (Q8).
7. **An alias must not be a string that parses as an IPv4 number.** In the check container, curl and musl read `000…001` as 0.0.0.1, and `0x7f000001` and `2130706433` as 127.0.0.1. Start every alias with a letter, for example `z` plus 32 hex (Q8).
8. **Listen on `:443` only.** A server listening on both `[":80", ":443"]` serves the app over plain HTTP on :80 with **no redirect**. Listen on `:443` only, and Caddy adds its own redirect server on :80 (Q2).
9. **Mount `/data` as a named volume.** The image declares **no** `VOLUME`. Without a named volume on `/data`, certificates and keys are lost every time the container is re-created (Q1).
10. **Reloads still drop a few new connections.** From inside the Docker network, about 5 HTTP/1.1 requests per reload failed with "Empty reply from server" at roughly 1,100 req/s, and 2 HTTP/2 requests in 5 reloads failed with a reset (caddyserver/caddy#8233 reproduced). Through Docker Desktop's port forwarding it was about 20 per reload. In-flight requests and long downloads were *not* cut by reloads (Q10).
11. **Use a directory bind mount for the config, never a single-file mount.** After an atomic rename on the host, a single-file mount showed the file as missing inside the container (Docker Desktop; on Linux it would keep showing the old inode). A directory mount followed every rename (Q3, Q10).
12. **`caddy validate` is not a semantic check.** It accepts a dial with no port, a host with spaces and a CA that is "not a url". The runner's own patterns remain the only real gate (Q2).

## Q1. The image

Commands: `docker buildx imagetools inspect caddy:2.11.9-alpine`; `docker pull caddy:2.11.9-alpine`; `docker image inspect …`; `docker run --rm --network none caddy:2.11.9-alpine sh -c 'id; caddy version; getcap /usr/bin/caddy; which wget nc curl; busybox --list; apk info'`.

| Item | Value |
|---|---|
| Tag exists | yes, `caddy:2.11.9-alpine`, created 2026-11-05, base alpine:3.24 (3.24.4) |
| Multi-arch index digest | `sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` |
| linux/amd64 manifest | `sha256:fc9cbc100585871d18d4e451cca7021785c90a7006087427ae5ceb3e4efe6424` |
| linux/arm64/v8 manifest | `sha256:9ee998103a2bc0d4392bbe9738b4069da1562d6920b3cd8088cfd098a8270120` |
| Compressed size | amd64 24,793,574 B (23.6 MiB); arm64 23,506,604 B (22.4 MiB), 5 layers |
| On disk (arm64) | 88 MB unpacked (`docker images`: DISK USAGE 88MB, CONTENT SIZE 23.9MB); `/usr/bin/caddy` alone is 47 MB |
| User | none set, so **root** (`uid=0(root)`); `/usr/bin/caddy` has `cap_net_bind_service=p` |
| Caddy | `v2.11.9 h1:bhZtcRKQOq0fuLvEgCdPYvUxXyGn9kzjG4lh2332DTE=` |
| Default CMD | `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`, WORKDIR /srv |
| Env | `XDG_CONFIG_HOME=/config`, `XDG_DATA_HOME=/data` |
| Exposed | 80/tcp, 443/tcp, **443/udp**, 2019/tcp (metadata only) |
| `VOLUME` | **none** (`Config.Volumes: null`). No anonymous volume is created, so `/data` must be mounted. |
| StopSignal | none |
| Tools | busybox 1.37.0 (`wget`, `nc`, `timeout`, `nslookup`, `netstat`, `kill`...), **curl 8.23.0** (OpenSSL 3.5.9, c-ares, HTTP2), `ssl_client`. No `openssl` binary. |

The Dockerfile installs curl on purpose: `apk add ca-certificates curl libcap mailcap` (caddy-docker `2.11/alpine/Dockerfile`), and `apk info -r curl` shows nothing depends on it. A later release could drop it, so check it again for each pinned digest.

busybox `wget` options (complete): `-c -q -S --spider -O FILE -o LOGFILE --header STR --post-data STR --post-file FILE -Y on/off -P DIR -U AGENT -T SEC`. There is **no `--max-redirect`**, and `-T` is a read timeout, not a total one.

busybox `nc` options: `-e PROG -l -lk -p PORT -s ADDR -w SEC -i SEC -n -u -b -v -o FILE -z`.

busybox `timeout`: `timeout [-s SIG] [-k KILL_SECS] SECS PROG ARGS`.

Full help texts: `q1-tools-help.txt`.

## Q2. A minimal JSON config

Field names were learned by `caddy adapt`ing an equivalent Caddyfile with the image itself (`q2/adapt-output.txt`), and the defaults were checked in the v2.11.9 source.

**Real case (Let's Encrypt only)**, `conf/recommended-le.json`. The aliases shown are placeholders.
```json
{
  "admin": { "disabled": true },
  "logging": { "logs": { "default": { "level": "INFO", "writer": { "output": "stderr" }, "encoder": { "format": "json" } } } },
  "storage": { "module": "file_system", "root": "/data/caddy" },
  "apps": {
    "http": {
      "http_port": 80, "https_port": 443,
      "grace_period": "10s",
      "servers": {
        "zekno": {
          "@id": "gen-5f3a9c1e7d2b4a60",
          "listen": [":443"],
          "protocols": ["h1", "h2"],
          "routes": [
            { "match": [{ "host": ["app-one.example.com"] }],
              "handle": [{ "handler": "reverse_proxy", "upstreams": [{ "dial": "zab12cd34ef56ab78cd90ef12ab34cd56e:8080" }] }],
              "terminal": true },
            { "handle": [{ "handler": "static_response", "status_code": 404 }] }
          ]
        }
      }
    },
    "tls": { "automation": { "policies": [ { "issuers": [ {
      "module": "acme",
      "ca": "https://acme-v02.api.letsencrypt.org/directory",
      "test_ca": "https://acme-staging-v02.api.letsencrypt.org/directory"
    } ] } ] } }
  }
}
```

**Test case**, `conf/recommended-internal.json`. Same as above, except the issuer is `{"module": "internal"}`, plus `"pki": {"certificate_authorities": {"local": {"install_trust": false}}}` under `apps`.

What each part does (verified unless marked otherwise):

- **Admin off.** `"admin": {"disabled": true}` logs `"admin endpoint disabled"` (warn). The config is still autosaved to `/config/caddy/autosave.json`.
- **One server on :443, HTTP on :80 redirected.** Auto-HTTPS logs "server is listening only on the HTTPS port but has no TLS connection policies; adding one to enable TLS", then "enabling automatic HTTP->HTTPS redirects". It starts a second server, `remaining_auto_https_redirects`, on :80. That server answers **every** Host with `308 Permanent Redirect` to `https://<host><path>?<query>`, unknown hosts included (`q2-runtime-behaviour.txt`).
- **Don't use `listen: [":80", ":443"]` on one server.** Caddy still logs "enabling automatic HTTP->HTTPS redirects", but a plain-HTTP request on :80 got `HTTP/1.1 200 OK` and the app's body, with no redirect (`q2/both/both-listen.txt`).
- **Certificates only for hosts in routes.** "enabling automatic TLS certificate management" listed exactly the route hosts, also when the catch-all 404 route (no host matcher) was present. An unknown SNI, or no SNI, gets a TLS alert ("tlsv1 alert internal error"), and a domain removed from the config is no longer served.
- **A valid SNI with another `Host` header.** Without the catch-all route this returned an **empty 200**. With a final catch-all `static_response 404` it returns 404 (`q2/catchall.txt`).
- **HTTP/3 off.** `"protocols": ["h1","h2"]`. `netstat -tuln` in the proxy showed only TCP :80 and :443 (plus Docker's DNS on 127.0.0.11). No UDP 443, no Alt-Svc header, and ALPN answers `h2`. The redirect server prints `"protocols":["h1","h2","h3"]` but also "HTTP/3 skipped because it requires TLS", and binds no UDP.
- **Storage.** The default is already `$XDG_DATA_HOME/caddy` = `/data/caddy`; the explicit `storage` block just makes it visible.
- **Let's Encrypt only.** An explicit `acme` issuer with `ca` = the LE production directory does it. Source (`modules/caddytls/automation.go` v2.11.9): when no issuer is configured, `DefaultIssuers(email)` returns ACME, and adds ZeroSSL **only when an email is set**. ZeroSSL is used only when the CA URL starts with `https://acme.zerossl.com/` (`acmeissuer.go`).
  - Run with `--network none` (no CA reachable), both the explicit issuer and "no `tls` app at all, no email" tried only `https://acme-v02.api.letsencrypt.org/directory`. The account path was `/data/caddy/acme/acme-v02.api.letsencrypt.org-directory/users/default/default.json`. Then: `"msg":"will retry","attempt":1,"retrying_in":60,"max_duration":2592000` (30 days). Output: `q2/offline/`.
  - **Recommendation:** use the explicit issuer block, so a future default change cannot bring ZeroSSL in.
- **Durations.** JSON durations accept strings (`"10s"`); `caddy adapt` writes nanoseconds.
- **`grace_period` lives at `apps.http.grace_period`**, not on the server. On the server, `grace_period` would be an unknown field.

### `caddy validate`

Command: `docker run --rm --network none -v <dir>:/w:ro caddy:2.11.9-alpine caddy validate --config /w/<file>.json`. Results in `q2/validate-output.txt` and `q2/validate-empty.txt`.

| Config | stdout | stderr (last line) | exit |
|---|---|---|---|
| good (LE or internal) | `Valid configuration` | info lines | 0 |
| truncated JSON | | `"msg":"config is not valid JSON: unexpected end of JSON input, at offset 35; did you mean to use a config adapter (the --adapter flag)?"` | 1 |
| unknown field `routez` | | `"msg":"loading http app module: decoding module config: http: json: unknown field \"routez\""` | 1 |
| unknown handler | | `"msg":"loading http app module: provision http: server zekno: setting up route handlers: route 0: loading handler modules: position 0: loading module 'reverse_proxyy': unknown module: http.handlers.reverse_proxyy"` | 1 |
| listen `:99999` | | `"msg":"loading http app module: http: invalid configuration: invalid listener address ':99999': invalid start port: ..."` | 1 |
| empty file | | `"msg":"decoding config: EOF"` | 1 |
| **dial `noport`** (no port) | `Valid configuration` | | **0** |
| **host `bad host with spaces`** | `Valid configuration` | | **0** |
| **acme `ca: "not a url"`** | `Valid configuration` | | **0** |
| **`{}`** | `Valid configuration` | | **0** |
| `null` | | Go panic, nil pointer in `caddy.Validate` | **2** |

- Errors are a JSON log line on stderr; the program reads `msg` of the last `"level":"error"` line.
- Validate runs fine **inside the running proxy** (`docker exec <proxy> caddy validate --config ...`, 0.1 s). It does not disturb the live server. A throwaway `--network none` container also works (0.2 s).

## Q3. Reloading without the admin API

Setup: the proxy runs `caddy run --config /etc/zekno-proxy/caddy.json` with `admin.disabled: true`. The host *directory* `proxy-etc/` is bind-mounted read-only at `/etc/zekno-proxy`. Each new config is written as `caddy.json.tmp`, then `mv` over `caddy.json`.

**SIGUSR1 works with admin disabled** (verified). `docker kill -s USR1 zk015-proxy`, and also `docker exec zk015-proxy kill -USR1 1`, produce:
```
{"level":"info",...,"msg":"reloading config from last-known source","signal":"SIGUSR1","file":"/etc/zekno-proxy/caddy.json","adapter":""}
...
{"level":"info",...,"msg":"autosaved config (load with --resume flag)","file":"/config/caddy/autosave.json"}
{"level":"info",...,"msg":"successfully reloaded config from file","signal":"SIGUSR1","file":"/etc/zekno-proxy/caddy.json","adapter":""}
```
The new route served right away, and the new certificate (internal issuer) was obtained in about 3 ms. An unchanged file is reloaded in full; it is not skipped.

### Failed reloads (`q3/reload-failures*.txt`)

The old config kept serving in every one of these cases:

| Case | Log line |
|---|---|
| truncated JSON | `"msg":"failed to reload config from file",...,"error":"config is not valid JSON: unexpected end of JSON input, at offset 35; ..."` |
| unknown handler (provision error) | `"error":"loading new config: loading http app module: provision http: ... unknown module: http.handlers.reverse_proxyy"` |
| two servers on :443 | `"error":"loading new config: loading http app module: http: invalid configuration: server zekno2: listener address repeated: tcp/:443 (already claimed by server 'zekno')"` |
| start failure (bind on an address the container lacks) | `"error":"loading new config: http app module: start: listening on 10.255.255.1:8081: listen tcp 10.255.255.1:8081: bind: cannot assign requested address"` |
| file missing | `"error":"reading config from file: open /etc/zekno-proxy/caddy.json: no such file or directory"` |

The bind failure happened *after* the new servers had started; Caddy rolled back and kept serving.

- **An empty file is a disaster.** Caddy logs `"successfully reloaded config from file"`. All servers stop (every site returned 000), and `"admin endpoint started","address":"localhost:2019"` appears inside the container. It writes **no** "autosaved config" line. A later good file reloaded normally, and port 2019 closed again.
- **A read race, seen once.** Right after `mv` on the macOS host, a USR1 read failed with ENOENT on a file that existed. A later loop of 30 write, rename and read cycles had no mismatch. This is likely a Docker Desktop file-sharing effect; still, confirm the result every time.

### A reliable success signal (`q3/reload-and-confirm.txt`, `bin/reload-and-confirm.sh`)

1. Generate the config with a fresh nonce, `"@id": "gen-<16 hex>"`, on the server object. `@id` is accepted with admin disabled and is kept in the autosave.
2. Write it atomically into the mounted directory, then `docker exec <proxy> caddy validate --config /etc/zekno-proxy/caddy.json` (exit 0 required).
3. Record T, then run `docker exec <proxy> kill -USR1 1`. Don't use `docker kill -s USR1`; see Q10.
4. Poll `docker logs --since T <proxy>` (fractional Unix seconds work) for a JSON line with `"signal":"SIGUSR1"` and `msg` either `"successfully reloaded config from file"` or `"failed to reload config from file"`. The failure line carries `error`.
5. Confirm with `docker exec <proxy> grep -q '"@id":"gen-…"' /config/caddy/autosave.json`. Autosave is written only after a successful load, so this also catches the empty-config case: the log said success, but there was no autosave, so the nonce was missing.

Verified result for a good config: "successfully reloaded" and nonce found. For a bad config: "failed to reload … unknown module" and nonce absent.

### The alternative: admin on a unix socket, reloaded with `caddy reload` (`q3/unix-socket-reload.txt`)

Config: `"admin": {"listen": "unix//run/caddy-admin.sock", "config": {"persist": false}}`. Caddy warns `"admin endpoint on open interface; host checking disabled"`. The socket is `s-w------- root /run/caddy-admin.sock`, and no TCP port is opened.

- `docker exec <proxy> caddy reload --config /etc/zekno-proxy/caddy.json --address unix//run/caddy-admin.sock` is **synchronous**, about 0.13 s, exit 0 on success.
- A bad config gives exit **1** and `"msg":"sending configuration to instance: caddy responded with error: HTTP 400: {\"error\":\"loading config: ... unknown module ...\"}"`. Start failures are reported the same way, and the old config keeps serving.
- An empty file gives **exit 0**: all sites go down, admin moves to TCP localhost:2019 and the socket disappears. Every later `caddy reload` over the socket fails (`dial unix /run/caddy-admin.sock: connect: no such file or directory`) until someone reloads through localhost:2019 or restarts the container.
- A config without an `admin` block does the same thing (admin moves to localhost:2019).

**Which is safest.** SIGUSR1 with admin disabled: no admin API exists at all (two of the 2026 advisories were about it). The cost is an asynchronous result, read from the log line plus the nonce check above. The unix socket gives a cleaner synchronous signal, but it brings the admin API back, and one bad file locks the runner out. Either way, `caddy validate` plus the nonce check is needed, because both paths accept `{}` and an empty file as a successful load.

## Q4. Upstream names across restarts (V23)

Topology:
- `zk015-app-a` (the same image running `caddy run`, answering `app=<name> host=<container id>`) on its "compose" network `zk015-app-net-a`.
- `docker network connect --alias <openssl rand -hex 16> zk015-route-a zk015-app-a`.
- The proxy on its own `zk015-proxy-net` (ports published) plus `docker network connect zk015-route-a zk015-proxy`.
- Route `app-one.example.com` → `<alias>:8080`.
- A client loop on the host (`bin/loop.sh`): one HTTPS request every ~0.13 s.

| Experiment | Result |
|---|---|
| **`docker kill` (SIGKILL) of the app, restart policy `unless-stopped`** | **Not** restarted. `docker kill` is a manual stop; State stayed `exited`, RestartCount 0. |
| **Crash** (`docker exec app kill -TERM 1`), 6 times, an intruder container started on the network right after each crash (`q4/crash-iterations.txt`) | Each time the app came back with its **old address 172.21.0.2**. Docker 29 handed the intruders new sequential addresses (.5, .6, ...). The proxy failed 0.16 s, 0.17 s, 0.32 s, 0.8 s, 1.6 s and 3.3 s: exactly Docker's doubling restart back-off, nothing added by Caddy. Every failure was `502` with an empty body. Not one response came from an intruder. |
| **`docker restart`** 5 times with an intruder started at the same moment | 0.39–0.51 s per restart, same address back, alias kept. 1 or 2 requests got 502 around each restart (0.15–0.3 s). No intruder responses. |
| **Forced address reuse** (`q4/reuse3-events.txt`, `q4/reuse3-after.txt`) | Route network `zk015-route-b` with subnet /29, so five usable addresses, all taken: proxy .2, app .3, fillers .4 .5 .6. The app was made to crash on start; its address .3 was freed during the back-off and the intruder `docker start`ed into **.3**. The app's next restart failed with `failed to set up container networking: no available IPv4 addresses on this network's address pools` and **Docker gave up: `exited`, not retried again**. 394 requests over 57 s were all 502, logged as `dial tcp: lookup <alias> on 127.0.0.11:53: no such host`. A direct `curl http://10.231.77.3:8080/` from inside the proxy answered `app=INTRUDER`, but **0 proxied responses came from the intruder**. After a filler was freed and `docker start` ran, the app took **10.231.77.4** with its alias unchanged, and the proxy served `app=b` at once, **with no reload**. |

Conclusion:
- Caddy 2.11.9 resolves the upstream name each time it dials (Go resolver, no cache). It does not resolve once at load. The design's open point V23 is closed for Caddy, on Docker Desktop.
- New fact: when a restart fails at network setup, the restart policy stops trying. The container stays `exited` until something starts it.
- Docker's embedded DNS answers NXDOMAIN for the alias while the container is down. `resolv.conf` in the proxy has `options ndots:0` and, on this machine, no `search` line. On a Linux host whose `/etc/resolv.conf` has `search` domains, Docker copies them. Go would then try `<alias>.<search domain>` after the NXDOMAIN, which is a theoretical leak to an outside name. **Not verified.**
  - `nslookup <alias>.` (trailing dot) did resolve through Docker's DNS, so a trailing-dot dial may be a hardening option; Caddy with a trailing-dot dial was not tried.

## Q5. Connecting and disconnecting the proxy while it serves (`q5/`)

- **Under load the changes were invisible on other routes.** Five rounds of `docker network connect zk015-route-c zk015-proxy`, `disconnect zk015-route-b`, `connect zk015-route-b` and `disconnect zk015-route-c` ran under load on app-one (route-a): 234/234 requests got 200. A 64 KiB download over HTTPS, throttled to 4 KB/s, kept going through all of it (200, 65,536 bytes, 15.2 s). Every command exited 0. Published ports were unchanged.
- **The hazard: a request through a just-removed network hung for 11.6 minutes.** The request for the route whose network was just removed (app-two over route-b, which the config still named) **hung**. `netstat` in the proxy showed `10.231.77.2:47168 -> 10.231.77.4:8080 ESTABLISHED`, Send-Q 227. That was a pooled keep-alive connection bound to the removed interface; TCP retransmitted into nothing. It lasted **about 695 s**, from 1795067993 to 1795068688, and ended only because the proxy was killed. Without that it would have run until the kernel gave up (about 15 minutes by default, not measured).
- **The safe order works.** First reload a config without the route. Only then disconnect. Note that the old pooled connection stays open after the reload (it is no longer used, and closes at its idle timeout). Joining is the reverse: connect first, then reload with the route; that gave 200 at once (`q5/safe-order.txt`).
- **Rule for the runner:** never disconnect the proxy from a route network that the loaded config still uses.

## Q6. Port clash (`q6/`)

**Port held by another container** (the proxy held 127.0.0.1:18080):
```
$ docker run -d --name zk015-clash1 -p 127.0.0.1:18080:80 caddy:2.11.9-alpine caddy respond --listen :80 hi
ad20a772...        <- stdout: the container ID (it WAS created)
docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint zk015-clash1 (43b6...): Bind for 127.0.0.1:18080 failed: port is already allocated

Run 'docker run --help' for more information
exit=125
```
- The container is left behind in state `Created`, with `.State.Error` holding the same text and `ExitCode=128`. The runner must `docker rm` it.
- With `--rm`, the same text and exit 125, and nothing is left.

**Port held by a host process** (`python3 -m http.server --bind 127.0.0.1 18081`):
```
docker: Error response from daemon: ports are not available: exposing port TCP 127.0.0.1:18081 -> 127.0.0.1:0: listen tcp4 127.0.0.1:18081: bind: address already in use
exit=125
```
This wording is **Docker Desktop's** (its host-side port forwarder). Docker Engine on Linux words it differently (`failed to bind host port ...: address already in use` or `Error starting userland proxy: listen tcp4 ...: bind: address already in use`, from docs and memory, **not verified**).

For a program to match: exit code **125**, plus stderr containing **`port is already allocated`** (another container) or **`address already in use`** (another process). Both strings include the `host:port`.

## Q7. Certificates on disk (`q7/`)

Internal issuer, verified (`find /data`):
```
/data/caddy/certificates/local/<domain>/<domain>.crt   (chain, PEM)
/data/caddy/certificates/local/<domain>/<domain>.key   (private key, 227 B, mode 0600)
/data/caddy/certificates/local/<domain>/<domain>.json  ({"sans":["<domain>"],"issuer_data":null})
/data/caddy/pki/authorities/local/{root,intermediate}.{crt,key}
/data/caddy/instance.uuid, /data/caddy/last_clean.json, /data/caddy/locks/
```
All directories are 0700 and all files 0600, owned by root.

Let's Encrypt layout. The issuer key is the CA URL made safe:
```
/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<domain>/<domain>.{crt,key,json}
/data/caddy/acme/acme-v02.api.letsencrypt.org-directory/users/default/default.json   (+ key)
```
- The account path is **verified** from the offline run's log. The certificate path follows from certmagic's `KeyBuilder` (`certificates/<Safe(issuerKey)>/<Safe(domain)>/<Safe(domain)>.crt|.key|.json`), **from source**.
- Staging certificates (`test_ca`) would sit under `acme-staging-v02.api.letsencrypt.org-directory`.
- OCSP staples go to `/data/caddy/ocsp/<domain>-<hash>` (source); Let's Encrypt has stopped OCSP, so expect none.
- `Safe()` maps `*` to `wildcard_`, `:` to `-`, `+` to `_plus_` and spaces to `_`, then drops anything outside `[\w@.-]`.

Deleting one domain (verified):
- **Domain no longer in the config:** `docker exec <proxy> rm -rf /data/caddy/certificates/local/<domain>` exited 0, with no log noise. When the domain came back later, a new certificate was obtained ("obtaining certificate" … "certificate obtained successfully").
- **Right order:** load the config without the domain, then remove the folder. Recommended removal for every issuer:
  `docker exec <proxy> sh -c 'rm -rf /data/caddy/certificates/*/<domain> /data/caddy/ocsp/<domain>-*'`. The domain is validated by the runner's pattern, so the glob is safe.
- **Wrong order** (folder deleted while the domain is still in the config): Caddy kept serving from its memory cache across reloads and did **not** re-create the file. After a proxy restart it **obtained a new certificate**. With Let's Encrypt that is a new issuance and counts against rate limits.

## Q8. The health check (`q8/`)

Run from a short-lived container of the same image on the app's route network:
```sh
docker run --rm --network zekno-route-<app> --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 65534:65534 --memory 32m --pids-limit 16 \
  caddy@sha256:<digest> \
  curl -sS -o /dev/null --max-time 5 --max-filesize 1024 --proto '=http' \
       -w '%{http_code}|%{exitcode}|%{errormsg}' 'http://<alias>:<port><path>'
```
- It works non-root, read-only and with no capabilities. Each run took **0.29–0.42 s wall** on this machine.
- curl follows no redirect unless given `-L`. `--proto '=http'` refuses anything else.
- Quote `'=http'` in zsh: unquoted, `=http` is expanded to a command path (that happened here).

Results (curl, `q8/curl-results.txt`):

| Target | exit | `http_code` | errormsg |
|---|---|---|---|
| 200 | 0 | 200 | |
| 302 | 0 | **302** (not followed) | |
| 500 | 0 | 500 | |
| 64 KiB body | **63** | 200 | `Exceeded the maximum allowed file size (1024) with 1024 bytes` (it stopped after 1 KiB) |
| body trickled forever, no length | 63 | 200 | same, after 0.88 s |
| `Content-Length: 10000000` | 63 | 200 | `Maximum file size exceeded` (no body read) |
| port closed (refused) | 7 | 000 | `Failed to connect to <alias>:8090 after 0 ms: Could not connect to server` |
| accepts, never answers | 28 | 000 | `Operation timed out after 5002 milliseconds with 0 bytes received` |
| **status line, then nothing** | **28** | **200** | `Operation timed out after 5001 milliseconds with 0 bytes received` |
| not HTTP (SSH banner) | 1 | 000 | `Received HTTP/0.9 when not allowed` |
| alias unknown (letters) | 6 | 000 | `Could not resolve host: <alias> (Domain name not found)` |
| alias `000…000` (32 zeros) | 7 | 000 | `Failed to connect to 0.0.0.0:8080` |

**Rule:** healthy if and only if exit ∈ {0, 63} **and** 200 ≤ `http_code` ≤ 399. Exit 63 only happens once the headers are complete. `http_code` alone would wrongly pass the "status line then nothing" case.

**Aliases that look numeric are read as addresses.** In the check container (curl and musl `getent`), `00000000000000000000000000000001` → 0.0.0.1, while `0x7f000001` and `2130706433` → 127.0.0.1. A 32-digit decimal string was not parsed (overflow). Make every alias start with a letter. Go (Caddy) does not parse such forms, but the check container does.

**busybox wget** (`timeout 6 wget -q -S -O /dev/null -T 5 URL`, `q8/wget-nc-results.txt`) is unsuitable:
- On 302 it **followed** the redirect: `HTTP/1.1 302 Found; HTTP/1.1 200 OK`, exit 0.
- 500 gives exit 1 (`server returned error: HTTP/1.1 500 ...`), and refused gives exit 1.
- No answer: exit 1, `download timed out`. Status line then nothing: exit 1. A trickling body is never cut, so the outer `timeout` kills it (exit 143).

**busybox nc with a hand-written request** (`printf 'GET … HTTP/1.0\r\nHost: …\r\nConnection: close\r\n\r\n' | timeout 5 nc -w 5 host port | head -c 1024 | head -n 1`) works but is fragile:
- The pipeline's exit is always 0; refused, no answer and an unknown name are told apart only by stderr (`nc: bad address '…'`, `punt!`).
- The "status line then nothing" case also reads as `HTTP/1.1 200 OK`, and the status line must be parsed by hand.

**Recommendation: use curl, with the rule above.**

## Q9. TLS from outside (`q9/tls-outside.txt`)

With the internal issuer, the proxy published 127.0.0.1:18443→443 and 127.0.0.1:18080→80. The internal root was copied out with `docker cp zk015-proxy:/data/caddy/pki/authorities/local/root.crt`.

```
$ curl --cacert root.crt --resolve app-three.example.com:18443:127.0.0.1 https://app-three.example.com:18443/
app=a host=5aa6af2d4f43
http=200 verify_result=0 http_version=2
$ openssl s_client -connect 127.0.0.1:18443 -servername app-three.example.com | openssl x509 -noout ...
subject=   (empty, as Caddy's internal CA issues)
issuer=CN=Caddy Local Authority - ECC Intermediate
notBefore=Nov 19 06:03:26 2026 GMT  notAfter=Nov 19 18:03:26 2026 GMT   (12 h leaf)
X509v3 Subject Alternative Name: critical  DNS:app-three.example.com
chain: leaf -> "Caddy Local Authority - ECC Intermediate" -> "Caddy Local Authority - 2026 ECC Root"; Verify return code: 0 (ok)
ALPN protocol: h2; no Alt-Svc header
$ curl -i --resolve app-three.example.com:18080:127.0.0.1 'http://app-three.example.com:18080/path?x=1'
HTTP/1.1 308 Permanent Redirect
Location: https://app-three.example.com/path?x=1
```
An unrouted SNI gives `curl: (35) ... tlsv1 alert internal error`. The redirect drops the non-standard port, as expected in production on port 443.

Headers the app receives (`q10/forwarded-headers.txt`): the client sent forged `X-Forwarded-For: 6.6.6.6`, `X-Forwarded-Proto: gopher` and `X-Real-Ip: 6.6.6.6`.
- Caddy **replaced** XFF (`172.22.0.1`), XFP (`https`) and XFH (`echo.example.com:18443`), and added `Via: 2.0 Caddy`.
- It passed `X-Real-Ip: 6.6.6.6` through **unchanged**.
- `Host` is passed as received, port included.
- The client address seen was the Docker bridge gateway (172.22.0.1), because Docker Desktop's port forwarding hides the real client. Linux with iptables DNAT normally keeps it (**not verified**).

## Q10. Other things a runner must know

**Start-up** (`q10/startup/startup-times.txt`):
- `docker run` returns in 0.28–0.32 s, and the first log line comes about 0.2 s after the run starts.
- `"msg":"serving initial configuration"` follows at +0.21–0.23 s. The internal certificate was obtained at +0.26 s on a fresh volume and loaded from storage on an existing one. The first 200 (via `docker exec curl`) came at +0.42–0.47 s.
- Watch for `serving initial configuration` as the "started" signal. A failed start logs the error and the process exits 1 (docs: exit 1 = failed startup, don't auto-restart).

**Log format.**
- One JSON object per line on stderr: `level`, `ts` (float Unix seconds), `logger` (absent on the core lines), `msg`, then fields.
- Lines worth matching: `serving initial configuration`; `successfully reloaded config from file`; `failed to reload config from file` (with `error`); `certificate obtained successfully` (`identifier`, `issuer`); `could not get certificate from issuer`; `will retry` (`attempt`, `retrying_in`, `max_duration`); `logger: http.log.error` for each failed proxied request.
- The proxied-request error line embeds the request: client IP, all headers except those Caddy redacts by default (not verified), and the TLS server name. Its volume grows with failed traffic.

**In-flight requests on reload** (`q10/inflight-results.txt`, `q10/grace-reload.txt`):
- These all completed with 200 across 6 reloads, with either the eternal or a 10 s `grace_period`: two 64 KiB downloads at 4–6 KB/s (HTTP/1.1 and HTTP/2, 10–16 s), and six requests waiting 3 s for a slow upstream. A download outlasted the 10 s grace by about 5 s and was still not cut. No cancellation at reload was seen (caddyserver/caddy#8078 not reproduced in this form).

**New connections during reload** (`q10/inside-load-5reloads.txt`): curl from a client container on the proxy's network, 24 in parallel.
- Baseline: 1,500/1,500 OK for both protocols.
- With 5 reloads in 7 s: **HTTP/1.1, 27 of 8,000 failed** (`exit 52 Empty reply from server`, about 5 per reload). **HTTP/2, 2 of 8,000** (`exit 35 Connection reset by peer`).
- From the macOS host through Docker Desktop's forwarding: about 20 HTTP/1.1 failures per reload (`q10/one-reload-load.txt`), and once a burst of HTTP/2 TLS failures that did not happen again and did not appear inside the network. That one is unexplained, most likely Docker Desktop's forwarder.
- **Every reload costs a few new connections**, so reload only when routes or aliases change.

**Shutdown and grace** (`q10/grace-sigterm.txt`, `q10/grace-reload.txt`):
- SIGTERM: Caddy logs `"shutting down apps, then terminating"`, closes its listeners at once (new connections fail) and waits for in-flight requests.
- **With the default eternal grace**, a request to an upstream that never answers kept the container `running` and serving nothing (12 s observed, unbounded). Caddy has **no default upstream response timeout**: such a request also hung 60 s, until the client gave up.
- With `grace_period: "10s"`, the stuck request was cut at 10 s, Caddy exited, the restart policy restarted it, and it served again **11.0 s** after the SIGTERM.
- `docker restart` of the proxy during a stuck request took 10.76 s (Docker's 10 s stop timeout, then SIGKILL).

**Restart policy versus signals** (`q10/sig/restart-policy-vs-docker-kill.txt`): six containers ran > 12 s, received USR1, then crashed (SIGTERM to PID 1 from inside).

| Policy, stop signal, how USR1 was sent | Restarted after the crash? |
|---|---|
| unless-stopped, none, `docker kill -s USR1` | **no** |
| always, none, `docker kill -s USR1` | **no** |
| always, `--stop-signal SIGTERM`, `docker kill -s USR1` | yes |
| unless-stopped, `--stop-signal SIGTERM`, `docker kill -s USR1` | **no** |
| unless-stopped, none, `docker exec … kill -USR1 1` | yes |
| always, none, `docker exec … kill -USR1 1` | yes |

`docker start` clears the flag again (verified). This matches moby's `killWithSignal`, as recalled, not re-read for this report: any `docker kill` sets `HasBeenManuallyStopped`, and when no stop signal is configured it also calls `ExitOnNext()`, which cancels the restart. The Docker docs don't mention `docker kill`.

**Use `docker exec <proxy> kill -USR1 1`** (busybox `kill`, reload verified). Run the proxy with `--restart unless-stopped` or `always`.
- Docs: after a daemon restart, `always` comes back even if it had been stopped by hand, while `unless-stopped` stays stopped if it was stopped. Neither was tested here: restarting Docker Desktop would have touched containers that are not mine.
- Docs also say a policy takes effect only after 10 s of uptime, yet containers that crashed after 1–2 s were restarted with back-off here.

**Bind-mounting the config** (`q10/single/bind-mount-rename.txt`):
- A single-file bind mount, after an atomic rename on the host, showed `No such file or directory` inside the container, and stayed that way after an in-place write. On Linux the usual effect is the old content (not verified).
- A directory bind mount followed all 30 write, rename and read cycles at once. **Mount the directory.**

**Other things noticed:**
- When admin is disabled, the autosave still goes to `/config/caddy/autosave.json`, with keys sorted, written only on success.
- After the empty-config incident, every later reload logs `"logger":"admin","msg":"stopped previous server","address":"localhost:2019"` (harmless; port 2019 was closed).
- Caddy adds `Via` to upstream requests and responses.
- With several upstreams on one route, the default load balancing is random with no retry. **Not tested**: a dead copy probably means 502s for part of the traffic until its alias resolves to nothing.

## Verified versus not verified

**Verified by running** (Docker Desktop 29.6.1, arm64):
- **Image:** digests, sizes, root user, file capability, no `VOLUME`, busybox and curl present, help texts.
- **JSON config:** the config shape; `admin.disabled`; :443-only plus the automatic :80 redirect (308, keeps path and query); the both-ports server that serves plain HTTP; certificates only for route hosts; the catch-all 404; HTTP/3 off with no UDP socket; internal issuer certificates; `grace_period` location and effect.
- **`caddy validate`:** outputs and exit codes, including the permissive cases and the `null` panic.
- **Reload signals:** SIGUSR1 reload with admin disabled; failed reloads keep the old config; the empty-file disaster; nonce in autosave as a success check; unix-socket `caddy reload`, its exit codes and its lock-out failure.
- **Restart policy:** `docker kill -s USR1` disables it; `docker exec kill -USR1 1` does not.
- **Aliases:** Caddy resolves them per connection; address reuse by another container never misroutes; outage windows equal Docker's restart back-off; Docker gives up when a restart fails at network setup.
- **Proxy networks:** connect and disconnect under load without touching other routes; the 11.6-minute hang when disconnecting under a live route; the safe order.
- **Errors and certificates:** port-clash error texts on Docker Desktop; certificate layout for the internal issuer; deleting a domain's folder in both orders; re-issue after restart.
- **Health check:** the curl, wget and nc matrices; numeric alias parsing in the check container; the cost of a hardened check container.
- **TLS from outside:** certificate SAN, chain and redirect.
- **Running behaviour:** forwarded headers; start-up time; in-flight requests across reloads; dropped new connections per reload; single-file versus directory bind mounts.
- **Let's Encrypt only (offline):** with an explicit issuer and with no issuer and no email, only `acme-v02.api.letsencrypt.org` was attempted; the account path; retry fields (60 s first retry, 30-day max).

**Not verified, from docs or source only:**
- Default issuers add ZeroSSL only when an email is set; ZeroSSL only via its own CA URL. https://github.com/caddyserver/caddy/blob/v2.11.9/modules/caddytls/automation.go and https://github.com/caddyserver/caddy/blob/v2.11.9/modules/caddytls/acmeissuer.go
- Signals and exit codes: SIGUSR1 reload rules, SIGINT twice forces exit, exit 1 = failed start. https://caddyserver.com/docs/command-line and https://github.com/caddyserver/caddy/blob/v2.11.9/sigtrap_posix.go
- Data directory must persist and is not a cache: https://caddyserver.com/docs/conventions
- The Let's Encrypt certificate folder name and the OCSP path (certmagic `KeyBuilder`): https://github.com/caddyserver/certmagic/blob/master/storage.go
- The test CA (LE staging) is used only during retries, and staging certificates are never served (field comment and research note; behaviour not run).
- HTTP-01 and TLS-ALPN-01 challenge handling by the redirect server (no real CA allowed).
- Restart policies across a Docker daemon restart, and the 10-second rule: https://docs.docker.com/engine/containers/start-containers-automatically/
- Everything on **Linux Docker Engine**: Q4 and Q5 there, the Linux wording of the host-port clash, single-file bind mounts showing stale content, client source address with DNAT, rootless Docker and ports below 1024, and `search` domains in a container's resolv.conf.
- How long the Q5 hang would have lasted without the kill (about 15 minutes, from Linux `tcp_retries2` defaults).
- Caddy's default redaction of `Authorization` and `Cookie` in error logs.
- Load balancing with several upstreams when one copy is down.
- moby's `killWithSignal` internals: recalled, consistent with the experiment, not re-read.
