/**
 * The lines `zekno add --list` and `zekno add postgres --show` print, at a
 * terminal and piped, as contracts/commands.md writes them
 * (specs/012-templates, "`zekno add --list`" and "`zekno add <template>
 * --show`"; board `AddLook`), for the tests of the drawing and of the
 * command (tasks T032, T034).
 *
 * The board draws the first set. A contributor's template is one file and
 * one line in the index, with no other change (FR-022, SC-009), so a test of
 * what the first set looks like reads the first set's texts alone
 * (`FIRST_TEXTS`), and a test of a command, which reads every template this
 * zekno carries, compares the board's lines exactly only while the
 * catalogue is the first set, and else their words in order
 * (`sameWords`), since a longer name widens every column.
 */
import { FIRST, TEMPLATE_TEXTS } from "../../src/templates/catalogue"
import { catalogue } from "../../src/templates/catalogue"

/** The texts of the first set alone, from the index: what the board draws. */
export const FIRST_TEXTS = TEMPLATE_TEXTS.filter(([file]) =>
  (FIRST as readonly string[]).includes(file.slice(0, -".json".length))
)

/** Whether the catalogue this zekno carries is the first set alone. */
export const onlyFirstSet = (): boolean => catalogue().length === FIRST.length

/** A line with each run of spaces one space: its words and their order. */
export const sameWords = (line: string): string =>
  line.trim().replace(/\s+/g, " ")

export const POSTGRES_IMAGE =
  "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc"

/** `--list` at a terminal (contracts/commands.md), from column 2. */
export const LIST = [
  "  postgres  PostgreSQL 18.7  A relational database        by zekno",
  "  mysql     MySQL 9.7        A relational database        by zekno",
  "  mongodb   MongoDB 9.0      A document database          by zekno",
  "  redis     Redis 8.10       A cache and key-value store  by zekno",
]

/** `--list` piped (board), with tabs. */
export const LIST_PIPED = [
  "postgres\tPostgreSQL\t18.7\tzekno",
  "mysql\tMySQL\t9.7\tzekno",
  "mongodb\tMongoDB\t9.0\tzekno",
  "redis\tRedis\t8.10\tzekno",
]

/** `zekno add postgres --show` at a terminal (contracts/commands.md), the digest whole (D25), in a window wide enough for it. */
export const SHOW = [
  "  PostgreSQL 18.7  A relational database. By zekno.",
  "  postgres",
  `  Source        image          ${POSTGRES_IMAGE}`,
  "  Deploy        restart        always",
  "  Networking    port           5432, not published",
  "  Variables     secrets        POSTGRES_PASSWORD",
  "                plain          POSTGRES_USER=app, POSTGRES_DB=app",
  "  Volumes       postgres-data  /var/lib/postgresql",
  "  Secrets",
  "  POSTGRES_PASSWORD       made on your machine, 32 random characters",
  "  DATABASE_URL            built from it, for your own services",
  "  Good to know",
  "  Zekno does not back up this data. It is kept in a Docker volume on your server.",
  "  The image is the official one, pinned by digest. A newer one comes with a newer zekno.",
  "  Nothing was changed.",
]

/** `zekno add postgres --show` piped (contracts/commands.md), with tabs. */
export const SHOW_PIPED = [
  `postgres\tsource.image\t${POSTGRES_IMAGE}`,
  "postgres\tdeploy.restart\talways",
  "postgres\tnetworking.port\t5432",
  "postgres\tvariables.secrets\tPOSTGRES_PASSWORD",
  "postgres\tvariables.plain.POSTGRES_USER\tapp",
  "postgres\tvariables.plain.POSTGRES_DB\tapp",
  "postgres\tvolumes.postgres-data\t/var/lib/postgresql",
  "made\tPOSTGRES_PASSWORD\t32",
  "built\tDATABASE_URL\tpostgres://app:{POSTGRES_PASSWORD}@{service}:5432/app",
]
