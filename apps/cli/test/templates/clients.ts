/**
 * A client for each template of the first set (specs/012-templates,
 * contracts/contributing.md, TT3; research R4's probe; plan.md, D23), for the
 * template tests with Docker (docker.test.ts) and the end-to-end run with
 * real Docker (test/scenarios/templates-real-docker.test.ts).
 *
 * Each connects from a service of the app named `app`, of the template's own
 * image, that reads the template's connection secret from its environment,
 * to the template's service under its own name. The connection secret is
 * split by the shell's own parameter expansion inside the container, so the
 * password reaches `PGPASSWORD`, an option file of mode 600, `mongosh`'s
 * `process.env` or `REDISCLI_AUTH`, and is never an argument of any process.
 * Each also checks that a wrong password is refused, and for MongoDB and
 * Redis that no password at all is too.
 *
 * Each kind of database speaks its own protocol, so a new kind of software
 * needs a client of its own here: code, reviewed as code
 * (CONTRIBUTING.md, "A pull request that changes more"). A template without
 * one gets every other check and a skipped test that says the reviewer
 * connects by hand.
 */

/** The service of the app the client runs in: the template's image, started with `sleep infinity`. */
export const CLIENT_SERVICE = "app"

/** One client: what runs in the app's service, what it prints once it connected, and commands that must fail. */
export type Client = {
  /** What `docker compose exec -T app` runs; it connects with the connection secret from its environment. */
  connect: readonly string[]
  /** What `connect` prints once connected, as the template's own user and database. */
  prints: RegExp
  /** Arguments of `docker compose exec -T`, each a connection that must be refused: a wrong password, or none. */
  wrong: readonly (readonly string[])[]
}

/** The clients, by template name. */
export const CLIENTS: Readonly<Record<string, Client>> = {
  postgres: {
    connect: [
      "sh",
      "-c",
      'u=${DATABASE_URL#postgres://}; export PGUSER=${u%%:*}; r=${u#*:}; export PGPASSWORD=${r%%@*}; h=${r#*@}; export PGHOST=${h%%:*}; p=${h#*:}; export PGPORT=${p%%/*}; export PGDATABASE=${p#*/}; psql -tAc "select current_user || chr(32) || current_database()"',
    ],
    prints: /^app app$/,
    wrong: [
      [
        "-e",
        "PGPASSWORD=wrong",
        "app",
        "psql",
        "-h",
        "postgres",
        "-U",
        "app",
        "-d",
        "app",
        "-tAc",
        "select 1",
      ],
    ],
  },
  mysql: {
    connect: [
      "sh",
      "-c",
      'u=${DATABASE_URL#mysql://}; user=${u%%:*}; r=${u#*:}; pw=${r%%@*}; h=${r#*@}; host=${h%%:*}; p=${h#*:}; port=${p%%/*}; db=${p#*/}; umask 077; printf "[client]\\npassword=%s\\n" "$pw" > /tmp/c.cnf; mysql --defaults-extra-file=/tmp/c.cnf -h "$host" -P "$port" -u "$user" "$db" -N -e "select current_user(), database()"',
    ],
    prints: /^app@%\s+app$/m,
    wrong: [
      [
        "app",
        "sh",
        "-c",
        'printf "[client]\\npassword=wrong\\n" > /tmp/w.cnf; mysql --defaults-extra-file=/tmp/w.cnf -h mysql -u app app -e "select 1"',
      ],
    ],
  },
  mongodb: {
    connect: [
      "mongosh",
      "--quiet",
      "--nodb",
      "--eval",
      'const d = connect(process.env.MONGODB_URI); const s = d.runCommand({connectionStatus: 1}); print(s.authInfo.authenticatedUsers.map(u => u.user + "@" + u.db).join(",") + " " + d.getName())',
    ],
    prints: /^app@admin app$/,
    wrong: [
      [
        "app",
        "mongosh",
        "--quiet",
        "--nodb",
        "--eval",
        'const d = connect(process.env.MONGODB_URI.replace(/:[^:@]*@/, ":wrong@")); d.runCommand({ping: 1})',
      ],
      [
        "app",
        "mongosh",
        "--quiet",
        "--nodb",
        "--eval",
        'const d = connect("mongodb://mongodb:27017/app"); const r = d.runCommand({listCollections: 1}); if (r.ok !== 1) throw new Error("refused")',
      ],
    ],
  },
  redis: {
    connect: [
      "sh",
      "-c",
      'r=${REDIS_URL#redis://}; u=${r%%@*}; export REDISCLI_AUTH=${u#*:}; h=${r#*@}; redis-cli --no-auth-warning --user "${u%%:*}" -h "${h%%:*}" -p "${h#*:}" ping',
    ],
    prints: /^PONG$/,
    wrong: [
      [
        "-e",
        "REDISCLI_AUTH=wrong",
        "app",
        "sh",
        "-c",
        "redis-cli --no-auth-warning -h redis ping | grep -q '^PONG'",
      ],
      ["app", "sh", "-c", "redis-cli -h redis ping | grep -q '^PONG'"],
    ],
  },
}
