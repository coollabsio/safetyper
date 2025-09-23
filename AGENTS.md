# AGENTS
Commands:
- dev: `bun run dev` (Chrome), `bun run dev:firefox` (Firefox)
- build: `bun run build`, `bun run build:firefox`; package: `bun run zip`, `bun run zip:firefox`
- type-check: `bun run check`
- tests: not configured; recommend Vitest
- single test (after Vitest): `npx vitest run path/to/file.test.ts -t "name"`

Lint/Format:
- not configured; recommend ESLint + Prettier (TS/Svelte plugins)
- style: 2-space indent; single quotes; semicolons; trailing commas

Code Style:
- imports: prefer named; absolute from `src` via TS paths; side-effects last
- types: strict TS; avoid `any`; explicit returns; narrow with guards
- naming: PascalCase components; camelCase vars/functions; UPPER_SNAKE env/consts
- errors: try/catch; never swallow; add context; `console.error` in bg; user-safe UI
- Svelte: Svelte 5 runes; no direct DOM; typed stores; CSS scoped
- WXT: use `defineBackground`/`defineContentScript`; message passing; avoid long blocking work

Repo Notes:
- No Cursor/Copilot instruction files found
- See `CLAUDE.md` for architecture and entrypoints

Development Notes:
- Do not start the dev server in the background
- Do not run build dev commands.