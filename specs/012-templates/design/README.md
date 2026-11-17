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
how Redis gets its password (`AddLook.dc.html`, right column) wait for the maintainer.

Versions and digests on the boards are examples. Each is fixed when its template is built and
tested.

They are HTML mock-ups of terminal screens, 14px Geist Mono on the app's colours. Open one in a
browser beside the canvas's `support.js`, or look at the canvas.
