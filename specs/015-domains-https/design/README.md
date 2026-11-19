# Design of feature 015, domains and HTTPS

**Status**: approved on 2026-11-19, with the ten open points decided as recommended. Screens are built last, so a board can still change before its screen exists.

The words of every new line are in [`lines.md`](./lines.md). The boards are on the design canvas, in the row "Domains and HTTPS (spec 015)", and kept here as files:

| Board | Shows |
|---|---|
| `DomainsAdd` | `zekno domain add` and `zekno domain rm`, and what is refused |
| `DomainsDeploy` | `zekno deploy` with a domain: the check line, the panel's row, waiting for the certificate, later deploys |
| `DomainsDns` | The DNS check, the stops before signing, the warnings, and the other sentences |
| `DomainsHealth` | A deploy that waits for a health check: the fifth stage, healthy, not healthy |
| `DomainsList` | `zekno domain`, with no terminal, and the new rows of `zekno settings`, `zekno status` and `zekno doctor` |
| `DomainsApp` | The full-screen app: the settings screen, an app's screen with a Domains box, the deploy screen |

How they were drawn: the lines of single commands with the components zekno uses today (`Line`, the deploy panel, the stage row), at 100 columns; the screens that exist from the docs' stored captures (`apps/web/content/screens`) and the app's real deploy screen, with only the proposed rows added. Example values only.
