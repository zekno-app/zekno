# Content Contract

Copy has two homes. Site-wide copy (`site`, `links`, `nav`, `footer`, `sources` and the labels
the shared chrome needs) is in `apps/web/config/site.ts`. The landing page's own copy is in
`apps/web/modules/landing/content/index.ts`. Components import from these and
contain no user-facing strings of their own, apart from accessibility labels tied to a control.

## Exports

| Export | Type | Notes |
|--------|------|-------|
| `pending` | `Record<string, string \| Placeholder>` | Every unresolved fact, in one place |
| `bannedPhrases` | `string[]` | Checked by the test and the release check |
| `site` | `{ name, tagline, title, description, repoUrl }` | `title` and `description` feed page metadata |
| `links` | `Record<string, Link>` | `earlyAccess`, `github`, `docs`, `roadmap`, `license`, `reportVulnerability`, `contact`, `privacy`, `terms` |
| `nav` | `Link[]` | In-page anchors |
| `hero` | `{ announcement: { badge, text }, headline, body, status }` | |
| `why` | `{ statement, flaw, answer, sources: Link[] }` | One source per named company |
| `parties` | `Party[]` | 3 |
| `steps` | `DeployStep[]` | 5 |
| `sampleSecrets` | `SampleSecret[]` | 3, fake |
| `breach` | `{ action, reset, captions }` | |
| `features` | `FeatureBlock[]` | 4 |
| `teamStages` | `TeamStage[]` | 4 |
| `threats` | `{ heading, intro, scenarios, metadataNote }` | 6 scenarios |
| `comparison` | `{ heading, intro, columns, rows }` | 6 rows |
| `openSource` | `{ heading, body, parts }` | 5 parts |
| `faq` | `{ heading, intro, items }` | 8 items |
| `closing` | `{ heading, body }` | |
| `footer` | `{ groups, legal }` | |

## Undecided addresses and sources

Removed on 2026-11-12 at the maintainer's request: the placeholder registry, the bracketed
markers on the page, and the `check:content` release check. In their place:

- Addresses that are not decided yet (early-access form, contact, privacy, terms) are empty
  strings at the top of `apps/web/config/site.ts`. A button with an empty address stays on the
  page without navigating. A footer link with an empty address is hidden.
- Sources for claims about other companies are the `sources` record in the same file. Each
  incident source is the company's own report.
- `content.test.ts` checks that every claim naming a company has an `https://` source.

Nothing blocks publishing automatically any more. Before publishing, fill in the empty
addresses and re-read the copy for provider-neutral wording ("Hetzner prices" stays banned by
agreement, no longer by a check).
