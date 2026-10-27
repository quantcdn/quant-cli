# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QuantCDN CLI (`@quantcdn/quant-cli`) — a Node.js CLI tool for deploying static sites and managing assets on QuantCDN. Published as an npm package with a `quant` binary. Full ESM, requires Node >= 20.

## Commands

```bash
npm test                    # Run all tests (mocha)
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report (c8)
npm run lint                # ESLint (cli.js src tests)

# Run a single test file directly:
npx mocha 'tests/unit/commands/deploy.test.mjs'

# Named test suites:
npm run test:config
npm run test:deploy
npm run test:file
npm run test:page
npm run test:redirect
npm run test:purge
npm run test:unpublish
npm run test:delete
npm run test:functions
npm run test:conformance   # tests/conformance only (also part of npm test)
```

### Local development commands

- `quant serve [dir]` runs a built site locally (static files, edge functions, rules, local KV). Code: `src/commands/serve.js` and `src/serve/`. `--version-info` prints the package versions.
- `quant kv <list|get|set|delete> <store> [key] [value] --local` reads and writes the local KV state in `.quant/kv/` (`src/commands/kv.js`). Remote KV is not available yet.
- `quant kv-indexes [meta]` declares the KV indexes of `quant/meta.json` with a project-scoped portal token (`src/commands/kv-indexes.js`).
- The conformance suites in `tests/conformance/` run in `npm test` and in the CI step `Run conformance suites`.

## Architecture

### Dual-Mode CLI

The entry point (`cli.js`) supports two modes based on whether arguments are passed:
- **Interactive mode** (no args): Uses `@clack/prompts` for guided menu-driven workflow
- **CLI mode** (with args): Uses `yargs` for standard argument parsing

Both modes share the same command modules — each command exports both a `builder` (yargs options) and `promptArgs` (interactive prompts).

### Command Structure

Commands live in `src/commands/` and follow a standard pattern:

```javascript
export default {
  command: 'name [args]',      // yargs command string
  describe: '...',             // help text
  builder: (yargs) => {},      // CLI option definitions
  promptArgs: async () => {},  // interactive mode prompts (@clack/prompts)
  handler: async (args) => {}  // command execution logic
}
```

`src/commandLoader.js` registers every command and provides the interactive mode menu options.

### Configuration (`src/config.js`)

Config is loaded with this precedence: CLI args > env vars (`QUANT_CLIENT_ID`, `QUANT_PROJECT`, `QUANT_TOKEN`, `QUANT_ENDPOINT`) > `quant.json` > defaults. Required fields: `clientid`, `project`, `token`. The config module is a singleton with `fromArgs()`, `get()`, `set()`, `save()`.

### API Client (`src/quant-client.js`)

Axios-based wrapper for the QuantCDN API. Manages auth headers (`Quant-Customer`, `Quant-Project`, `Quant-Token`) and provides methods for all API operations (markup, files, publish, unpublish, delete, purge, search, WAF logs, edge functions).

### Helpers (`src/helper/`)

Utility modules: array chunking, file discovery with glob, MD5 comparison, path normalization, URL preparation, deployment resume state, revision tracking, delete response parsing, the edge function manifest schema (`functions-manifest.js`) and the shared single-function command (`single-function-command.js`).

### Edge function identity (7.0.0)

Every function is named by an explicit `uuid`; no code derives one. `functions-manifest.js` is the manifest schema and must stay identical to the Quant portal's `App\Helpers\TemplateManifestPaths` (rules and message text, including message order). UUIDs are checked for shape only (any version digit), except a function a rule references, which needs RFC 4122 v1-5 (`RULE_UUID`). `quant functions-add` is the only command that creates a UUID.

## Code Style

- ESM (`import`/`export`) throughout — file extensions required in imports
- 2-space indentation, single quotes, semicolons required, no trailing commas
- ESLint flat config (`eslint.config.js`), ES2022 target
- Unused variables prefixed with `_`

## Testing

- Mocha + Chai (expect) + Sinon + sinon-chai
- Test files use `.test.mjs` extension
- Tests mock the API client (`tests/mocks/quant-client.mjs`), filesystem (`sinon.stub(fs, ...)`), and HTTP calls (`axios-mock-adapter`, `nock`)
- `.mocharc.json` configures ESM loading with `--experimental-vm-modules`

## CI

GitHub Actions runs lint + test on Node 20 and 22 for pushes/PRs to main. Docker images built on release (Node 22 Alpine, multi-platform).
