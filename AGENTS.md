# Repository guide for AI agents and developers

## Repository map

- `projects/triangular-engine/` — the published Angular library.
- `projects/demo-app/` — the local demo application.
- `projects/triangular-engine/docs/` — user-facing library documentation.
- `docs/runbook/` — design notes and implementation history for larger features.
- `instructions/` — maintainer workflows and historical project notes.
- `.cursor/skills/` — Cursor-specific task guidance; keep it aligned with the public API.

## First steps

1. Read `projects/triangular-engine/README.md` for the supported consumer API.
2. Read `projects/triangular-engine/docs/ai-agents.md` for implementation conventions.
3. Inspect the relevant secondary entry point before changing it.
4. Check `git status --short` and preserve unrelated working-tree changes.

## Common commands

```powershell
npm install
npm run build:triangular-engine
npm test -- --watch=false --browsers=ChromeHeadless
npx ng serve demo-app
```

For a library-only edit loop, use `npm run watch`. `npm run start` prepares a linked library and starts its watch build; it does not serve the demo app.

## Change conventions

- Keep public exports and secondary-entry-point `public-api.ts` files intentional.
- Add or update a colocated `*.spec.ts` for behavior changes.
- Update user-facing docs and `CHANGELOG.md` for public API changes.
- Keep optional integrations isolated from the core entry point.
- Do not edit generated output in `dist/` or `out-tsc/`; rebuild it instead.

## Verification checklist

- Run the narrowest relevant tests, then the library build.
- Confirm imports use the intended public entry point.
- Check documentation links and examples against current symbols/selectors.
- For rendering changes, verify the demo app and asset paths when practical.

## Documentation source of truth

The package README and `projects/triangular-engine/docs/` describe the current consumer API. Treat `instructions/summary.md` and old runbooks as historical context unless they explicitly describe a current workflow.
