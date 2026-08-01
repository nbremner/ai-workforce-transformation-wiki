# AI Workforce Transformation Wiki

Public reading page for research wiki on scientific literature related to **AI workforce
transformation × industrial–organizational psychology**.

- **Live site:** <https://nbremner.github.io/ai-workforce-transformation-wiki/>
- **Canonical content:** [nbremner/llm-research-wiki](https://github.com/nbremner/llm-research-wiki) (`wiki/`)
- **Engine:** [Quartz 5](https://github.com/jackyzha0/quartz), pinned — see [UPSTREAM_QUARTZ.md](UPSTREAM_QUARTZ.md)

## Architecture

This repository is a **replaceable presentation adapter**. The canonical
research model and Markdown live in `nbremner/llm-research-wiki`; nothing here
is a second editable wiki.

```text
nbremner/llm-research-wiki@main  (canonical, editable)
        │  read-only checkout into .source-wiki/
        ▼
scripts/prepare-content.mjs      (deterministic publication adapter)
        │  allowlist + frontmatter stripping → content/
        ▼
Quartz 5 build                   → public/
        ▼
GitHub Pages
```

### Publication allowlist

Only these canonical paths are ever published:

| Canonical           | Published as      |
| ------------------- | ----------------- |
| `wiki/overview.md`  | `/` (homepage)    |
| `wiki/topics/*.md`  | `/topics/<name>`  |
| `wiki/sources/*.md` | `/sources/<name>` |

Everything else (`schema.md`, workflow docs, skills, scripts, tests, config,
runtime state) is excluded by construction, and `scripts/verify-publication.mjs`
fails the build if the boundary is violated.

### Stripped fields

`drive_file_id` and `file_hash` are removed from published frontmatter (never
from canonical files). The verifier greps every public artifact — HTML, search
index, sitemap — for those literals and fails on any hit.

## Local development

Prerequisites: Node 25 (`.nvmrc`), npm ≥ 10.9.

```bash
npm ci
npm run install-plugins
npm run test:publication            # adapter contract tests
git clone --depth 1 https://github.com/nbremner/llm-research-wiki .source-wiki
npm run prepare:content             # generate content/ from .source-wiki/wiki
npm run verify:publication -- --content-only --source .source-wiki/wiki
npm run check                       # tsc + prettier
npx quartz build                    # production build → public/
npm run verify:publication -- --source .source-wiki/wiki
npx quartz build --serve            # local preview at http://localhost:8080
```

`content/`, `public/`, and `.source-wiki/` are generated; never commit them.
`content/` is kept out of git via `.git/info/exclude` (written idempotently by
the adapter) rather than `.gitignore`, because Quartz's content glob honors
`.gitignore` and would otherwise see zero input files.

## Deployment

`.github/workflows/deploy.yml` builds from a fresh read-only checkout of the
canonical wiki and deploys only a verified static artifact. Triggers:

- push to `main` (frontend changes);
- `workflow_dispatch` (manual, for immediate publication);
- schedule, every 6 hours — canonical wiki changes reach the site with a
  bounded delay and **no cross-repository secrets**.

The deployed artifact is traceable to the canonical source commit via the
`prepare-content` manifest printed in the workflow logs.

## Upstream pin and upgrades

Quartz is pinned to an exact upstream commit; all plugins are npm packages
pinned by `package-lock.json`. See [UPSTREAM_QUARTZ.md](UPSTREAM_QUARTZ.md)
for the pin and the upgrade procedure. Do not edit `quartz/` core —
customization is limited to `quartz.config.yaml`, `quartz/styles/custom.scss`,
and the small condition registration in `quartz.ts`.

## Non-goals

No semantic search, generated related links, comments,
tag pages, recent notes, social-image generation, analytics, or Git-derived
created/modified dates.
