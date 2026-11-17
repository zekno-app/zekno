# Boards for templates

A copy of the row "Templates (spec 012)" of the design canvas
(https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW). **Approved by the maintainer on
2026-11-17.** They are binding for the look: colours, what is bold and what is dim, spacing and
alignment, and for the words of each line.

| Board | Shows |
|---|---|
| `AddTemplate.dc.html` | `zekno add postgres`: what it will add, the one question, the result, the next deploy, the options |
| `AddLook.dc.html` | The picker, `--list`, `--show`, a name that is another template's |
| `AddOther.dc.html` | A Compose file written by hand, each refusal, behaviour with no terminal |
| `TemplateFile.dc.html` | The template file, what each part is, the tests, how a template gets in |

Changed after the approval, because the maintainer refused Valkey in place of Redis on the same
day: the fourth template is `redis` (the official image), the example of a name people type is
`mongo`, and the `builds` part of the file is gone, since no template needs it. The words about
how Redis gets its password (`AddLook.dc.html`, right column) were approved on the same day.

Changed again on 2026-11-17, after the plan (`../plan.md`), with the maintainer's answers to it:

- The volume a template adds is named for its service in the app: `postgres-data`, mounted at
  `/var/lib/postgresql` (the path PostgreSQL 18's image uses; `/var/lib/postgresql/data` makes it
  refuse to start). `AddTemplate`, `AddLook` (`--show`), `AddOther` and `TemplateFile` show it.
- The versions are the real ones: PostgreSQL 18.7, MySQL 9.7, MongoDB 9.0, Redis 8.10. The
  digests are the real ones, shortened on the boards (`2ea8…1bbc`); zekno prints them whole.
- A template is one file and one line in the index (`TemplateFile`, its first line and step 1 of
  "How one gets in").
- The last two refusals of `AddOther` (the file changed while the question was open, and a folder
  with no settings file) are exit status 1, as `zekno settings` gives for the same cases. The
  others stay 2.
- 2026-11-17, found while building: the hand-written lines (`AddOther`) also carry a template's
  limits (`mem_limit`, `cpus`), as the settings file does, with no change to any line the boards
  show. The port is still left out, as `AddOther` draws it (contracts/commands.md).
- 2026-11-17, after the security review (T1): one more refusal, drawn as `AddOther` draws the
  others (`✖`, its first sentence bold, the second dim under it), status 2. A service of the file
  that already lists in its `secrets` a secret the template makes or builds is refused with
  `worker already reads a secret named POSTGRES_PASSWORD.` then `Remove it from worker.` (AD29,
  contracts/commands.md). AD7 keeps its words, for a plain variable of a service chosen to read.

The right column of `AddLook` still says "The numbers here are examples"; since this change they
are the real ones, and only the shortened digests differ from what zekno prints.

They are HTML mock-ups of terminal screens, 14px Geist Mono on the app's colours. Open one in a
browser beside the canvas's `support.js`, or look at the canvas.
