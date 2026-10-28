# Adopting quant serve

This guide is for a Quant site that has its own local copy of the edge: a small
router that serves `dist/`, runs the edge function bodies, and keeps an
in-memory KV store. `quant serve` (quant-cli 7.1.0 or later) does all of that
from the same `quant/` files that you deploy, so you can delete the local copy.

## What quant serve replaces

| Local glue | With quant serve |
|---|---|
| A static server for `dist/` with an index and 404 lookup | `quant serve dist`, with `/_quant404/index.html` for the 404 page |
| A router that maps `/api/*` to a function body | The rules in `quant/edge-rules.json` and the functions in `quant/edge-functions.json` |
| An in-memory KV store with seed data | Local KV from [`@quantcdn/edge-kv`](https://www.npmjs.com/package/@quantcdn/edge-kv), seeded from `initial_values` in `quant/meta.json` and `quant/kv-fixtures/` |
| A copy of the KV client in tests | The `@quantcdn/edge-kv` package |

Keep the scripts that are part of your application, for example a step that
bundles function sources into the committed function bodies.

## Steps

1. Install the CLI as a dev dependency, with an exact version:

   ```sh
   npm install --save-dev --save-exact @quantcdn/quant-cli@7.1.1
   ```

2. Add the scripts. If your function bodies are built from sources (for example
   `src/server/` to `quant/edge-functions/`), put that build in `--build`.
   With `--watch`, quant serve runs the build again when a file under `src/` or
   `public/` changes, and it reloads the functions and rules.

   ```json
   {
     "scripts": {
       "serve": "quant serve dist --build \"npm run build && npm run build:functions\" --port 4330",
       "dev:edge": "quant serve dist --build \"npm run build && npm run build:functions\" --watch --port 4330"
     }
   }
   ```

   To use the framework dev server with hot reload, run it with `--run` and send
   the requests that no rule answers to it with `--proxy`:

   ```sh
   quant serve --run "astro dev --host 127.0.0.1 --port 4321" --proxy http://127.0.0.1:4321
   ```

   Give the dev server `--host 127.0.0.1` when it listens only on IPv6 by
   default, or the proxy cannot reach it.

3. Move the seed data into fixtures. Each store gets one file,
   `quant/kv-fixtures/<store-name>.json`, with a JSON array of entries:

   ```json
   [
     {
       "key": "project:1",
       "value": {
         "name": "Example",
         "due": { "$date": "+6d", "format": "date" },
         "createdAt": { "$date": "-14d" }
       }
     }
   ]
   ```

   A `{"$date": ...}` value is `now` or a signed offset in minutes, hours or days
   (`+6d`, `-2h`, `30m`). With `"format": "date"`, the value is `YYYY-MM-DD`.
   `initial_values` in `quant/meta.json` are written first, and a fixture never
   replaces a value that exists. A file can have up to 5,000 entries and 1 MiB.
   The unique indexes in `meta.json` apply, so a duplicate stops the start with
   the file name, the entry number and the key.

4. If a value in `initial_values` is revealed once (an access key), start with
   `--seed-key <hex>` to make it a known value for local development and tests.
   The key exists only in the local state. Never use a seed key in a deploy.

5. Point Playwright at quant serve. `--memory` keeps no files, so each run
   starts from the same seed data:

   ```js
   webServer: {
     command: 'npm run build && npm run build:functions && npx quant serve dist --memory --seed-key <hex> --port 4330',
     url: 'http://127.0.0.1:4330',
     reuseExistingServer: !process.env.CI,
     timeout: 120000
   }
   ```

6. In unit tests, use `@quantcdn/edge-kv` instead of a local copy of the KV
   client. Give the function under test the `kvStore` from `createLocalKv`:

   ```js
   import { createLocalKv } from '@quantcdn/edge-kv';

   const { kvStore, backend } = createLocalKv({ indexes: { initialState: 'ACTIVE' } });
   await backend.createStore({ id: storeId, format: 2 });
   ```

   Declare the indexes from `quant/meta.json` with `backend.declareIndex`, so a
   test sees the same indexes as the site. The package README lists the options.

7. Add `.quant/` to `.gitignore`. quant serve keeps the local KV state there
   (mode 0600), and it writes its own `.quant/.gitignore` as well.

8. Delete the local router, the static server, the local KV copy and the code
   that wired them into the dev server. Run your API tests and the Playwright
   suite again.

## Check the result

- `npm run serve`, then open the site. The start-up output lists the stores, the
  rules, the libraries found in the project and any warnings.
- `quant kv --local list <store>` shows what the site wrote. A running server
  sees each write that `quant kv --local set` makes.
- `quant serve --indexes building` and `--kv-lag 1000` show the not-ready and
  list-lag states that production can have, so you can test the messages for them.

## Limits

quant serve runs documented edge behaviour. It does not run scheduled
functions, and it does not apply production security protections or production
time, memory and capacity limits. Geolocation and the client address are values
that you set with `--geo` and `--client-ip`. KV ledgers are not in quant serve
yet, so a feature that uses a ledger needs the deployed site until a later
release adds them. See [What quant serve does not emulate](../README.md#what-quant-serve-does-not-emulate).
