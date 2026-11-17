/**
 * The settings files `zekno add` is tried on (specs/012-templates, tasks T022
 * to T030). design.md's file of feature 010 already gives `web` and `worker`
 * the secret `DATABASE_URL`, which postgres offers, so adding postgres to it
 * is AD29, whoever reads it (security review T1). The board `AddTemplate`
 * starts from that app before its database: its next deploy carries
 * `SESSION_KEY` from before and `DATABASE_URL` and `POSTGRES_PASSWORD` new.
 * `BEFORE_FILE` is that file: design.md's, `DATABASE_URL` taken out of both
 * services.
 */
import { settingsText } from "../../src/settings/text"
import type { Settings } from "../../src/settings/types"
import { DESIGN_FILE, DESIGN_SETTINGS } from "./settings-files"

/** design.md's settings, `DATABASE_URL` taken out of both services. */
export const BEFORE_SETTINGS: Settings = {
  version: 1,
  services: [
    ["web", { ...DESIGN_SETTINGS.services[0]![1], secrets: ["SESSION_KEY"] }],
    [
      "worker",
      {
        image: "ghcr.io/acme/demo-worker:1.4.2",
        start: "bun run worker",
        restart: "always",
      },
    ],
  ],
}

/** The file of `BEFORE_SETTINGS`, as zekno writes it: design.md's text, two lines changed. */
export const BEFORE_FILE = settingsText(BEFORE_SETTINGS)

/** A file of one service, `web`. */
export const ONE_FILE = `{
  "zekno": 1,
  "services": {
    "web": { "source": { "image": "ghcr.io/acme/web:1" } }
  }
}
`

export { DESIGN_FILE }
