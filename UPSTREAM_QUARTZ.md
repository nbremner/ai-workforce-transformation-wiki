# Quartz Upstream Pin

This repository is a shallow adapter over Quartz. Do not edit Quartz core
(`quartz/`); customization is limited to `quartz.config.yaml`, small SCSS,
and (only where path-aware layout requires it) a minimal `quartz.ts` override.

- **Upstream URL:** https://github.com/jackyzha0/quartz
- **Upstream branch:** `v5` (upstream default branch as of the pin date)
- **Pinned commit:** `507ad7f3d4601d83482f61930fccf1c77f42a072`
- **Upstream version at pin:** 5.0.0
- **Initialized:** 2026-07-28
- **Node pin:** 25 (see `.nvmrc`; Quartz 5.0.0 requires `node >=22`, `npm >=10.9.2`)

## Upgrade procedure

1. `git fetch upstream`
2. Review upstream changes since the pinned commit:
   `git log --oneline 507ad7f3d4601d83482f61930fccf1c77f42a072..upstream/v5`
3. Pick the new target commit (prefer a tagged release or quiet point on `v5`).
4. On a branch: `git merge <new-commit>` — conflicts should only touch
   `quartz.config.yaml`, `quartz/styles/custom.scss`, or `quartz.ts`.
   If Quartz core conflicts appear, our adapter has drifted too deep; stop and
   reassess rather than resolving by hand-editing core.
5. `npm ci && npx quartz plugin install && npm run test:publication && npm run check`
6. `npm run prepare:content && npx quartz build && npm run verify:publication`
7. Update **Pinned commit**, **Upstream version at pin**, and the date above.
8. Merge to `main` only after CI is green and the live site is verified.
