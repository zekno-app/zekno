# Deploy version 2: the boards

Four boards, **approved by the maintainer on 2026-11-18**. They are the row "Deploy version 2 (spec 014)" of the design canvas (https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW).

| Board | Shows |
|---|---|
| `Deploy2Overtaken.dc.html` | A deploy refused because another reached the server first, and the rare case where zekno cannot tell which of two deploys with one number ran |
| `Deploy2Secrets.dc.html` | Today's quiet drop of a secret beside the new stop; a secret only the server holds that this machine cannot check; the same case when the runner is the one that refuses |
| `Deploy2Versions.dc.html` | zekno newer than the runner (a warning, the deploy works) and the runner newer than zekno (it stops before signing); the version lines that do not change |
| `Deploy2Refusals.dc.html` | Every refusal a runner can give, today's sentence and the proposed one; the one line of the app's deploy screen that changes; the README's note on what the hosted service can read |

## What is real in them

The panel, the stage row, the marks and the way a refusal and a warning are laid out were drawn by the program's own components (`DeployBlock`, `Line`) from `apps/cli/src/ui/ink`, at 100 columns, with example values. Only the sentences are new. The frame around each is the docs' frame.

## Known before building

- `lines.md` holds every line with its place in the code, today's wording and the model sentences. The boards were drawn after it; where they differ, the boards are the later ones.
- A refusal's first sentence is drawn in bold and must fit one line of 100 columns. That is why each refusal says what happened, then "Nothing of it ran." as a sentence of its own.
- A stop before signing is drawn with the summary panel and `✖ Checked`. Whether the panel shows at that point, or only the sentence, follows what the program does today for a stop at that stage; the plan checks it.
- The README's note is drawn as a short list. `lines.md` first proposed it as one long sentence.

## As built

Four more boards, `BuiltDeploy2Order`, `BuiltDeploy2Secrets`, `BuiltDeploy2Versions` and `BuiltDeploy2App`, are captures of the real program made on 2026-11-19 (the row "Deploy version 2 (spec 014): as built" of the canvas). `walkthrough.md` holds each capture as plain text, how it was made, and the comparison with the approved boards. Every approved sentence came out word for word; where the screens around them differ from the approved boards is written on the built boards and in `plan.md`, "As built".
