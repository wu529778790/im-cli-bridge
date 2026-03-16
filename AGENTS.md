# AGENTS.md

## Cursor Cloud specific instructions

### Overview

open-im is a single-process Node.js/TypeScript application that bridges IM platforms (Telegram, Feishu, QQ, WeCom, DingTalk, WeChat) to AI CLI tools (Claude, Codex, CodeBuddy). It has **no local infrastructure dependencies** (no databases, Docker, Redis, etc.) — all external dependencies are third-party cloud APIs requiring registration and API keys.

### Development Commands

See `CLAUDE.md` for the full list. Key commands:

- `npm run build` — compile TypeScript to `dist/`
- `npm run dev` — run from source with tsx (foreground)
- `npm run lint` — ESLint on `src/`
- `npm run test` — vitest (26 test files, 82 tests)
- `node dist/cli.js dashboard` — standalone web config UI on port 39282

### Startup Caveats

- The app requires **at least one IM platform configured** with valid credentials to start the bridge. Without credentials, `npm run dev` will print setup instructions and exit.
- Claude SDK mode (default) requires one of: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`.
- The `open-im dashboard` (or `node dist/cli.js dashboard`) command starts only the web config UI on port 39282 and does **not** require platform credentials — useful for configuration and testing the web UI independently.
- Internal HTTP services: Permission Server on port 35801, shutdown server on port 39281, web dashboard on port 39282.

### Testing Notes

- Tests run with `npm run test` (vitest) and do not require any external credentials or services.
- Lint warnings (32 warnings, 0 errors) are expected in the current codebase — mostly unused variables and `@typescript-eslint/no-explicit-any`.
- The `punycode` deprecation warning from Node.js is a known harmless warning from a transitive dependency.
