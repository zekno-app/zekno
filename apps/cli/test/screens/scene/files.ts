/**
 * The example app's files: `shop` described by a zekno.app.json, with the
 * shape of design.md's file (test/support/settings-files.ts `DESIGN_FILE`)
 * and the example's names.
 */

/** shop's settings as deployed: a web service and a worker, web with 512m of memory. */
export const SHOP_APP_FILE = `{
  "zekno": 1,
  "services": {
    "web": {
      "source": { "image": "ghcr.io/example/shop-web:1.4.2" },
      "deploy": {
        "start": "bun run start",
        "restart": "on-failure",
        "memory": "512m",
        "cpus": 1
      },
      "networking": { "port": 3000 },
      "variables": {
        "secrets": ["DATABASE_URL", "SESSION_KEY"],
        "plain": { "NODE_ENV": "production" }
      },
      "volumes": { "uploads": "/data/uploads" }
    },
    "worker": {
      "source": { "image": "ghcr.io/example/shop-worker:1.4.2" },
      "deploy": { "start": "bun run worker", "restart": "always" },
      "variables": { "secrets": ["DATABASE_URL"] }
    }
  }
}
`

/** The two values shop's services read, as the person types them. */
export const SHOP_VALUES = {
  DATABASE_URL: "postgres://shop:example@db:5432/shop",
  SESSION_KEY: "example-session-key",
}

/** shop's file before it has a database: web reads only SESSION_KEY, and the worker reads no secret. */
export const SHOP_BEFORE_DATABASE = SHOP_APP_FILE.replace(
  '"secrets": ["DATABASE_URL", "SESSION_KEY"]',
  '"secrets": ["SESSION_KEY"]'
).replace(',\n      "variables": { "secrets": ["DATABASE_URL"] }', "")

/** shop's file with one service, web. */
export const SHOP_ONE_SERVICE = `{
  "zekno": 1,
  "services": {
    "web": {
      "source": { "image": "ghcr.io/example/shop-web:1.4.2" },
      "deploy": {
        "start": "bun run start",
        "restart": "on-failure",
        "memory": "512m",
        "cpus": 1
      },
      "networking": { "port": 3000 },
      "variables": {
        "secrets": ["DATABASE_URL", "SESSION_KEY"],
        "plain": { "NODE_ENV": "production" }
      },
      "volumes": { "uploads": "/data/uploads" }
    }
  }
}
`
