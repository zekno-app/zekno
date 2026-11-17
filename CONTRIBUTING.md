# Contributing to Zekno

Zekno is pre-alpha. Its security design has not been independently audited. Most of the project
is not open to outside contributions yet. One part is: templates. This guide says what a template
is and how one gets into Zekno.

## What a template is

A template is one data file in `apps/cli/src/templates/files/`, named `<name>.json`, and one line
for it in that folder's `index.ts`: one file, and one line in the index.

It adds one or more services to an app's `zekno.app.json`, with the secrets they need made on the
user's machine. `zekno add postgres` is a template at work.

A template is data, read strictly. It is never code.

It ships inside the CLI with a release. Nothing is downloaded when it is used.

## The format

What each part is:

| Part | What it is |
|---|---|
| `template` | The version of the format. Always `1` in this version. |
| `name`, `title`, `about`, `software`, `author` | What the list and the docs page show. The author is credited. `name` is what a person types, and the file's own name. |
| `also` | Names people may type instead, such as `mongo` for `mongodb`. |
| `services` | What goes into `zekno.app.json`. Same format, same checks. Its volume `data` becomes `postgres-data` in the app, so no two services share one. A template may hold several services. |
| `makes` | Secrets made at random on the user's machine. |
| `offers` | A connection secret for the user's own services. `{service}` is the service's name in their app. |
| `notes` | Sentences shown before adding. Backups are always named. |
| `asks` | Questions to the user, such as a domain. Kept for the version that brings domains. Refused until then. |

PostgreSQL's file, as Zekno ships it:

```json
{
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
```

Its line in `apps/cli/src/templates/files/index.ts`:

```ts
  ["postgres", await import("./postgres.json", { with: { type: "text" } })],
```

The full rules, with every sentence the tests can say, are in
[`specs/012-templates/contracts/template-file.md`](specs/012-templates/contracts/template-file.md).

## The rules

A template file must meet every rule below. The tests check every one of them, the index
included. When one is broken, the test names the rule and the place, such as
`acme-db services.db.source.image: pin the image by digest.`

The file:

- It is named `<name>.json`: lowercase letters, digits and hyphens, starting with a letter, at most
  32 characters.
- It is at most 16 KiB of UTF-8 text, and one JSON object.
- It has no key twice, and no field this zekno does not know.

The fields:

- `template` is `1`.
- `name` is the file's own name.
- `title` is 1 to 40 letters, digits, spaces, dots, plus signs and hyphens, such as `PostgreSQL`.
- `about` is one sentence of at most 80 characters, ending with a full stop.
- `software` is the version as people name it, such as `18.7` or `9.7`.
- `author` is letters, digits and inner hyphens, at most 39 characters, such as a GitHub user name.
- `also` lists at most 8 other names, none twice and not the template's own.
- `makes` names 1 to 16 secrets, each `{ "kind": "password", "length": <24 to 64> }`.
- `offers` names at most 4 connection secrets, each at most 512 characters of letters, digits and
  `:/@?&=._%+~-`, with `{service}` and the made secrets in braces.
- `notes` lists 1 to 8 sentences, each at most 200 characters and ending with a full stop.
- A secret's name is capital letters, digits and underscores, starting with a letter, at most 128
  characters, and not one zekno keeps for itself.
- `asks` is refused, whatever its value.

The services, by the rules of `zekno.app.json`:

- `services` names 1 to 8 services.
- Each service passes every rule of a service in `zekno.app.json`: the same names, settings,
  values and limits.

The template's own rules:

- The image is named by its version and pinned by digest: `<name>:<tag>@sha256:<64 hex>`.
- The image comes from an allowed source: a Docker Official Image.
- `software` is the image tag of the first service, or its start before a dot (`9.7` for `9.7.4`).
- No service publishes a port. `networking.port` may be set; `networking.publish` may not.
- Every secret a service reads is made by the template.
- Every secret the template makes is read by one of its services.
- A connection secret is built from at least one made secret, and has a name of its own.
- Data is kept in named volumes. Each is added to the app as `<service>-<volume>`, which must be a
  volume name of at most 63 characters, and no other volume of the template may be added under
  the same name.
- `notes` holds `Zekno does not back up this data.` when a service keeps data in a volume.

Across the templates:

- No two templates share a name, or a name in `also`.

The index:

- One line per template file, in the order of the names, written as the line above.
- Nothing else is in `apps/cli/src/templates/files/` but the template files and `index.ts`.
- A file without its line is not in the CLI. The test says which line to add.

## Running the tests

Run `bun install` at the root of the repository. Then, in `apps/cli`:

```bash
bun run test:templates
```

For each template file, three lines:

```text
✔ postgres form, settings rules, image pinned, publisher allowed
✔ postgres no published port, data in a volume
✔ postgres starts with Docker, a client connects
```

- The first says the file reads, with every rule above met.
- The second says no service publishes a port, and its data is kept in a named volume.
- The third starts the template's service with Docker, with passwords made the way `zekno add`
  makes them, and connects to it with a client. It checks that the service keeps running, that no
  port is published, that the data is in a named volume, and that no command line holds a password.
  Then it removes the service and its volumes.

Without Docker, the third is skipped. With Docker, it pulls the image by its digest from Docker Hub
and starts it.

A client check exists for each kind of software in the first set. A new kind of software has
none, so its third line is skipped with the words
`<name> a client connects: no client check, the reviewer connects by hand`. Every other check still
runs. Say in your pull request how you connected to it.

## How one gets in

1. Copy a template file, change its values, and add its name to the index, one line.
2. Run the template tests.
3. Open a pull request. The tests run again on GitHub, with no access to any secret.
4. A maintainer reads it and merges it.
5. It ships with the next release, in `zekno add` and on the docs page, with its author.

## What the reviewer checks by hand

- Is it the software's official image?
- Is the description honest about what it does not do?
- Does it need a setting that weakens it?
- A start command that runs a shell: every word of it.

The reviewer also checks that:

- the pull request changes the template's file and its line in the index, and nothing else;
- the digest is the one the tag named on the day the file was written (the reviewer looks it up);
- the version is one the software's project supports;
- the author is the person who opened the pull request, or someone who agreed to be named.

## Allowed sources

A template's image is a Docker Official Image. The allowed sources are listed in
`apps/cli/src/templates/publishers.ts`. A template whose image comes from another source fails the
tests. Adding a source is the maintainer's decision, in a pull request of its own.

## A pull request that changes more

The check on GitHub runs the pull request's own copy of the tests and of the workflow. So a pull
request that changes anything but one template file and its line in the index, such as a test, a
workflow, the code or the allowed sources, is reviewed as code, line by line. It is never merged
because the check passed.

A client check for a new kind of software goes in `apps/cli/test/templates/clients.ts`. It is code,
and is reviewed as code.

Whether the check must pass before a merge is a setting of the repository, the maintainer's. So is
asking for a maintainer's approval before a first-time contributor's check runs.

## What a file cannot do

It is data, read strictly: no code, no unknown field, nothing fetched. It cannot mount a folder of
the server or run privileged, because settings cannot say those, and it cannot publish a port,
because the template rules refuse it.

The runner on the user's server starts it as it starts any other service of the app, with Docker
Compose, after it verified the deploy.

## Later, not now

A catalogue of its own, templates from an address, paying authors.

## Security

Report a security problem privately, as the README's
[Reporting a vulnerability](README.md#reporting-a-vulnerability) says. Never in a pull request or an
issue.

## Licence

A contribution is under the repository's [MIT licence](LICENSE). The Zekno name and logo are not.
