/**
 * The first set of templates (specs/012-templates, contracts/template-file.md,
 * "The first set"; tasks T006): the four files exactly as the contract writes
 * them, and the templates the reader gives for them (data-model.md, "A
 * template as read"). test/support/template-files.ts passes both on with the
 * rest of the test set.
 */
import type { ServiceSettings } from "../../src/settings/types"
import type { Template } from "../../src/templates/types"

/** The four files of contracts/template-file.md, "The first set", each with its final line feed. */
export const FIRST_SET: Readonly<Record<string, string>> = {
  postgres: String.raw`{
  "template": 1,
  "name": "postgres",
  "title": "PostgreSQL",
  "about": "A relational database.",
  "software": "18.7",
  "author": "zekno",
  "also": [],
  "services": {
    "postgres": {
      "source": { "image": "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc" },
      "deploy": { "restart": "always" },
      "networking": { "port": 5432 },
      "variables": {
        "secrets": ["POSTGRES_PASSWORD"],
        "plain": { "POSTGRES_USER": "app", "POSTGRES_DB": "app" }
      },
      "volumes": { "data": "/var/lib/postgresql" }
    }
  },
  "makes": {
    "POSTGRES_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "DATABASE_URL": "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app"
  },
  "notes": ["Zekno does not back up this data."]
}
`,
  mysql: String.raw`{
  "template": 1,
  "name": "mysql",
  "title": "MySQL",
  "about": "A relational database.",
  "software": "9.7",
  "author": "zekno",
  "also": [],
  "services": {
    "mysql": {
      "source": { "image": "mysql:9.7.4@sha256:df90258da46f6e7ff8574ff84f17618aba0765cac749928299c69fd4e7cb8ad8" },
      "deploy": { "restart": "always" },
      "networking": { "port": 3306 },
      "variables": {
        "secrets": ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD"],
        "plain": { "MYSQL_USER": "app", "MYSQL_DATABASE": "app" }
      },
      "volumes": { "data": "/var/lib/mysql" }
    }
  },
  "makes": {
    "MYSQL_ROOT_PASSWORD": { "kind": "password", "length": 32 },
    "MYSQL_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "DATABASE_URL": "mysql://app:{MYSQL_PASSWORD}@{service}:3306/app"
  },
  "notes": ["Zekno does not back up this data."]
}
`,
  mongodb: String.raw`{
  "template": 1,
  "name": "mongodb",
  "title": "MongoDB",
  "about": "A document database.",
  "software": "9.0",
  "author": "zekno",
  "also": ["mongo"],
  "services": {
    "mongodb": {
      "source": { "image": "mongo:9.0.8@sha256:b0c835c26e5997413e985000f1013c275377cd9607761c1784d486f6dd620b7f" },
      "deploy": { "restart": "always" },
      "networking": { "port": 27017 },
      "variables": {
        "secrets": ["MONGO_INITDB_ROOT_PASSWORD"],
        "plain": { "MONGO_INITDB_ROOT_USERNAME": "app" }
      },
      "volumes": { "data": "/data/db" }
    }
  },
  "makes": {
    "MONGO_INITDB_ROOT_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "MONGODB_URI": "mongodb://app:{MONGO_INITDB_ROOT_PASSWORD}@{service}:27017/app?authSource=admin"
  },
  "notes": [
    "Zekno does not back up this data.",
    "Your app connects as the database's administrator."
  ]
}
`,
  redis: String.raw`{
  "template": 1,
  "name": "redis",
  "title": "Redis",
  "about": "A cache and key-value store.",
  "software": "8.10",
  "author": "zekno",
  "also": [],
  "services": {
    "redis": {
      "source": { "image": "redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53" },
      "deploy": {
        "start": "sh -c 'umask 077 && printf \"requirepass %s\\n\" \"$REDIS_PASSWORD\" > /tmp/auth.conf && chown redis /tmp/auth.conf && exec docker-entrypoint.sh redis-server /tmp/auth.conf'",
        "restart": "always"
      },
      "networking": { "port": 6379 },
      "variables": { "secrets": ["REDIS_PASSWORD"] },
      "volumes": { "data": "/data" }
    }
  },
  "makes": {
    "REDIS_PASSWORD": { "kind": "password", "length": 32 }
  },
  "offers": {
    "REDIS_URL": "redis://default:{REDIS_PASSWORD}@{service}:6379"
  },
  "notes": ["Zekno does not back up this data."]
}
`,
}

const BACKUP = "Zekno does not back up this data."

/** One template of the first set as the reader gives it: one service of `name`, made secrets of 32 characters, one offer. */
const firstOf = (
  name: string,
  fields: Pick<Template, "title" | "about" | "software"> & {
    also?: string[]
    service: ServiceSettings
    makes: string[]
    offer: [string, string]
    notes?: string[]
  }
): Template => ({
  name,
  title: fields.title,
  about: fields.about,
  software: fields.software,
  author: "zekno",
  also: fields.also ?? [],
  services: [[name, fields.service]],
  makes: fields.makes.map((made) => ({
    name: made,
    kind: "password",
    length: 32,
  })),
  offers: [{ name: fields.offer[0], text: fields.offer[1] }],
  notes: fields.notes ?? [BACKUP],
})

/** The templates of the first set, as the reader gives them (data-model.md, "A template as read"). */
export const FIRST_TEMPLATES: Readonly<Record<string, Template>> = {
  postgres: firstOf("postgres", {
    title: "PostgreSQL",
    about: "A relational database.",
    software: "18.7",
    service: {
      image:
        "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc",
      restart: "always",
      port: 5432,
      secrets: ["POSTGRES_PASSWORD"],
      plain: [
        ["POSTGRES_USER", "app"],
        ["POSTGRES_DB", "app"],
      ],
      volumes: [["data", "/var/lib/postgresql"]],
    },
    makes: ["POSTGRES_PASSWORD"],
    offer: [
      "DATABASE_URL",
      "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app",
    ],
  }),
  mysql: firstOf("mysql", {
    title: "MySQL",
    about: "A relational database.",
    software: "9.7",
    service: {
      image:
        "mysql:9.7.4@sha256:df90258da46f6e7ff8574ff84f17618aba0765cac749928299c69fd4e7cb8ad8",
      restart: "always",
      port: 3306,
      secrets: ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD"],
      plain: [
        ["MYSQL_USER", "app"],
        ["MYSQL_DATABASE", "app"],
      ],
      volumes: [["data", "/var/lib/mysql"]],
    },
    makes: ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD"],
    offer: ["DATABASE_URL", "mysql://app:{MYSQL_PASSWORD}@{service}:3306/app"],
  }),
  mongodb: firstOf("mongodb", {
    title: "MongoDB",
    about: "A document database.",
    software: "9.0",
    also: ["mongo"],
    service: {
      image:
        "mongo:9.0.8@sha256:b0c835c26e5997413e985000f1013c275377cd9607761c1784d486f6dd620b7f",
      restart: "always",
      port: 27017,
      secrets: ["MONGO_INITDB_ROOT_PASSWORD"],
      plain: [["MONGO_INITDB_ROOT_USERNAME", "app"]],
      volumes: [["data", "/data/db"]],
    },
    makes: ["MONGO_INITDB_ROOT_PASSWORD"],
    offer: [
      "MONGODB_URI",
      "mongodb://app:{MONGO_INITDB_ROOT_PASSWORD}@{service}:27017/app?authSource=admin",
    ],
    notes: [BACKUP, "Your app connects as the database's administrator."],
  }),
  redis: firstOf("redis", {
    title: "Redis",
    about: "A cache and key-value store.",
    software: "8.10",
    service: {
      image:
        "redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53",
      start: String.raw`sh -c 'umask 077 && printf "requirepass %s\n" "$REDIS_PASSWORD" > /tmp/auth.conf && chown redis /tmp/auth.conf && exec docker-entrypoint.sh redis-server /tmp/auth.conf'`,
      restart: "always",
      port: 6379,
      secrets: ["REDIS_PASSWORD"],
      volumes: [["data", "/data"]],
    },
    makes: ["REDIS_PASSWORD"],
    offer: ["REDIS_URL", "redis://default:{REDIS_PASSWORD}@{service}:6379"],
  }),
}
