# QuantCDN CLI

Command line tools for QuantCDN.

## Installation

```bash
npm install -g @quantcdn/quant-cli
```

## Usage

The CLI can be used in two modes:

### Interactive Mode
Simply run:
```bash
quant
```
This will launch an interactive prompt that guides you through available commands and options.

### CLI Mode
```bash
quant <command> [options]
```

## Available Commands

### Configuration
- `quant init` - Initialize a project in the current directory
  ```bash
  quant init [--dir=<build-dir>]
  ```

- `quant info` - Show information about current configuration

### Content Management
- `quant deploy [dir]` - Deploy the output of a static generator
  ```bash
  quant deploy [dir] [--attachments] [--skip-unpublish] [--skip-unpublish-regex=pattern] [--enable-index-html] [--chunk-size=10] [--force]
  ```

- `quant file <file> <location>` - Deploy a single asset
  ```bash
  quant file path/to/file.jpg /images/file.jpg
  ```

- `quant page <file> <location>` - Make a local page asset available
  ```bash
  quant page path/to/page.html /about-us [--enable-index-html]
  ```

### Publishing Controls
- `quant publish <path>` - Publish an asset
  ```bash
  quant publish /about-us [--revision=latest]
  ```

- `quant unpublish <path>` - Unpublish an asset
  ```bash
  quant unpublish /about-us
  ```

- `quant delete <path>` - Delete a deployed path
  ```bash
  quant delete /about-us [--force]
  ```

### Cache Management
- `quant purge <path>` - Purge the cache for a given URL or cache keys
  ```bash
  quant purge /about-us                        # Purge by path
  quant purge "/*"                            # Purge all content
  quant purge --cache-keys="key1 key2"        # Purge by cache keys
  quant purge /about-us --soft-purge          # Mark as stale instead of deleting
  ```

### Redirects
- `quant redirect <from> <to> [status]` - Create a redirect
  ```bash
  quant redirect /old-page /new-page [--status=301]
  ```

### Edge Functions
Every function is named by a UUID. The UUID is its identity: keep it in your
repository and never change it after the first deploy. From 7.0.0 no command
creates or derives a UUID for you, except `quant functions-add`.

- `quant functions-add <manifest> <path> --description <text> [--type function|auth|filter] [--id <slug>]` - Add a function to a manifest with a new UUID. It uploads nothing, creates the manifest if it does not exist, and prints only the new UUID.
  ```bash
  quant functions-add quant/edge-functions.json quant/edge-functions/api.js --description "API" --id my-api
  ```

- `quant functions <manifest>` - Deploy every function in a manifest. The whole manifest is checked before the first upload: each entry needs `uuid`, `path`, `type` (`function`, `edge`, `auth` or `filter`) and `description`; `id` is optional (lowercase slug, unique).
  ```bash
  quant functions quant/edge-functions.json
  ```

- `quant function <file> <description> <uuid>` - Deploy one edge function
- `quant filter <file> <description> <uuid>` - Deploy one edge filter function
- `quant auth <file> <description> <uuid>` - Deploy one edge auth function (it returns 201 to let the request continue)
  ```bash
  quant function handler.js "My edge function" 43aec1f0-095b-4a76-a9c8-934bf3d49d59
  ```

### Local Development
- `quant serve [dir]` - Run the built site on this machine: static files, edge functions and edge rules. It needs no token. See [Run a site locally](#run-a-site-locally).
  ```bash
  quant serve dist --run "npm run dev" --proxy http://localhost:4321
  ```

- `quant kv <list|get|set|delete> <store> [key] [value] --local` - Read and write the local KV store. See [Local KV](#local-kv).
  ```bash
  quant kv list notes --local
  ```

- `quant kv-indexes [meta]` - Declare the KV indexes in `quant/meta.json`. See [Declare KV indexes](#declare-kv-indexes).
  ```bash
  quant kv-indexes --dry-run
  ```

### Search
- `quant search <operation>` - Perform search index operations
  ```bash
  quant search status                         # Show search index status
  quant search index --path=records.json      # Add/update search records
  quant search unindex --path=/url/to/remove  # Remove item from search index
  quant search clear                          # Clear entire search index
  ```

You may index new content or update existing content in the search index directly. Simply provide one or multiple records in JSON files. For example, consider a `search-records.json` file containing the following:

```json
[
    {
        "title": "This is a record",
        "url": "/blog/page",
        "summary": "The record is small and neat.",
        "content": "Lots of good content here. But not too much!"
    },
    {
        "title": "Fully featured search record",
        "url": "/about-us",
        "summary": "The record contains all the trimmings.",
        "content": "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "image": "https://www.example.com/images/about.jpg",
        "categories": [ "Blog", "Commerce", "Jamstack" ],
        "tags": [ "Tailwind" , "QuantCDN" ],
        "author": "John Doe",
        "publishDate": "2024-02-22",
        "readTime": "5 mins",
        "customField": "Any value you need"
    }
]
```

Required fields for each record:
- `title`: The title of the page
- `url`: The URL path of the page
- `content`: The searchable content

Common optional fields:
- `summary`: A brief description
- `image`: URL to an associated image
- `categories`: Array of category names
- `tags`: Array of tag names

You can include any additional key/value pairs in your records. These custom fields will be indexed and available for filtering, faceting, or display in your search integration.

### Validation
- `quant scan` - Validate local file checksums
  ```bash
  quant scan [--diff-only] [--unpublish-only] [--skip-unpublish-regex=pattern]
  ```

### WAF Logs
- `quant waflogs` - Access project WAF logs
  ```bash
  quant waflogs [--fields=field1,field2] [--output=file.csv] [--all] [--size=10]
  ```

## Global Options
These options can be used with any command:

```bash
--clientid, -c    Project customer id for QuantCDN
--project, -p     Project name for QuantCDN
--token, -t       Project token for QuantCDN
--endpoint, -e    API endpoint for QuantCDN (default: "https://api.quantcdn.io/v1")
```

## Configuration

The CLI can be configured using either:
1. Interactive initialization: `quant init`
2. Command line arguments (see Global Options)
3. Environment variables:
   - `QUANT_CLIENT_ID`
   - `QUANT_PROJECT`
   - `QUANT_TOKEN`
   - `QUANT_ENDPOINT`
4. Configuration file: `quant.json` in the current directory

Missing configuration will be handled differently depending on the context:
- Running `quant` with no arguments will prompt to initialize a new project
- Running specific commands without configuration will show detailed setup instructions

## Examples

```bash
# Initialize a new project
quant init

# Deploy a directory
quant deploy build --attachments

# Upload a single file
quant file ./logo.png /images/logo.png

# Create a redirect
quant redirect /old-page /new-page --status=301

# Purge cache with various options
quant purge "/*"                              # Purge all content
quant purge --cache-keys="key1 key2"          # Purge specific cache keys
quant purge /about --soft-purge               # Soft purge a path

# Deploy edge functions (the UUID is the function's identity)
quant functions-add quant/edge-functions.json quant/edge-functions/api.js --description "API" --id my-api
quant functions quant/edge-functions.json
quant function handler.js "My edge function" 43aec1f0-095b-4a76-a9c8-934bf3d49d59

# Check deployment status
quant scan --diff-only
```

## Run a site locally

`quant serve` runs a built site on your machine. It serves the static files,
runs your edge functions and applies your edge rules. It needs no token.

To replace a local copy of the edge in your project with `quant serve`, see [Adopting quant serve](docs/adopting-quant-serve.md).

```bash
quant serve                                  # serve ./dist at http://127.0.0.1:8787
quant serve public --port 9000
quant serve --build "npm run build"          # build once, then serve
quant serve --build "npm run build" --watch  # build again when src/ or public/ changes
quant serve --run "npm run dev" --proxy http://localhost:4321
quant serve --memory --seed-key $(openssl rand -hex 32)
quant serve --indexes building --kv-lag 500
quant serve --clock manual                   # time moves only with the control route
quant serve --reset
quant serve --version-info
```

Quant serve reads these files from the project directory: `quant/edge-functions.json`, `quant/edge-rules.json`, `quant/meta.json` and the KV fixtures. It also reads two local-only files, `quant/kv-ledgers.json` (local ledgers) and `quant/serve.json` (local project settings). No deploy command reads them, and they are never deployed. It reads `quant.json` only for the organisation and the project.

Flags:

- `[dir]` - The built site (default: `dist`).
- `--port` - Port to listen on (default: `8787`).
- `--host` - Address to listen on (default: `127.0.0.1`). Any other address makes the site and its KV data reachable on the network.
- `--functions` - Functions manifest (default: `quant/edge-functions.json`).
- `--rules` - Rules manifest (default: `quant/edge-rules.json`).
- `--meta` - Template metadata with the KV stores (default: `meta` in `quant/serve.json`, then `quant/meta.json`).
- `--fixtures` - Directory of KV fixtures (default: `quant/kv-fixtures`).
- `--org` - Organisation (default: `org` in `quant/serve.json`, the `quant.json` clientid, then `local`).
- `--project` - Project (default: `project` in `quant/serve.json`, the `quant.json` project, then `dev`). `quant serve` has no `--project` option of its own: it uses the global `--project` option of the CLI, so `quant serve --help` lists it with the global options.
- `--domain` - Host for the domain match of rules (default: the Host of the request).
- `--user-name` - Value for `{user_name}` in KV seed values (default: `git config user.name`, then `Owner`).
- `--build` - Command to run once before the server starts.
- `--watch` - Reload when files change. With `--build`, run the build again when files under `src/` or `public/` change.
- `--run` - Long-running command, for example a dev server, to start beside the server. Quant serve stops it when it stops. On macOS and Linux the command runs in its own process group, and quant serve stops the whole group. Some dev servers move to the background and the command exits 0 at once. If the process group is still alive, quant serve prints one notice, keeps serving and stops the group when it stops. If only the `--proxy` URL still answers (the dev server left the process group), quant serve says that it cannot stop that dev server. On Windows there is no process group: quant serve stops only the command, and it cannot stop a dev server that moved to the background.
- `--proxy` - Dev server URL. Requests that no rule ends go to this URL. WebSocket upgrades (for example, HMR) also go to this URL, after the auth rules of the path. Function rules do not run for an upgrade.
- `--geo` - Geolocation fields for functions, as a JSON object.
- `--client-ip` - Client address for functions.
- `--reset` - Delete the local KV state and seed the stores again.
- `--memory` - Keep the KV state in memory. Nothing is written to disk.
- `--seed-key` - Value of the first reveal-once entry (in the first store that has one), in hex: two characters for each byte of its `generate.bytes`. The other reveal-once entries get random values.
- `--kv-lag` - Delay in milliseconds before index lists show a change (default: `0`).
- `--indexes` - Index state for the session: `active` or `building` (default: `active`). With `building`, the indexes of the stores stay in the building state.
- `--clock` - `real` or `manual` (default: `real`). With `manual`, the time of the local KV stops at the start time and, in a session, moves only with `POST /_quant_serve/clock`. See [Local ledgers](#local-ledgers).
- `--version-info` - Print the versions of the CLI and its KV and test packages, then exit.
- `--pull-rules` - Read the rules and global headers of the portal project once at start, and run them with the rules of `quant/edge-rules.json`. See [Portal rules and remote KV](#portal-rules-and-remote-kv).
- `--kv-remote <name>` - Read the KV store `<name>` of the portal project once at start (at most 10,000 keys) and serve it from memory. Writes stay local. See [Portal rules and remote KV](#portal-rules-and-remote-kv).

A key that `initial_values` reveals once is shown in a box when the store is first seeded. Save the key then. Quant serve also writes it to a file under `.quant/kv/`.

## Local KV

`quant serve` keeps the KV data in `.quant/kv/` in the project directory. The folder is git-ignored. Use `--memory` to keep no files, or `--reset` to start again.

`quant kv --local` reads and writes the same data. It needs no token. A running `quant serve` sees each write. The store name is the name from `quant/meta.json`. For a pending ledger and for a ledger in a retired subject format, it prints a warning to stderr before the output, also when the command fails.

```bash
quant kv list notes --local
quant kv list notes --local --prefix post:
quant kv list notes --local --index by_author --equals author=ana
quant kv get notes post:1 --local
quant kv set notes post:1 '{"title":"Hello"}' --local
quant kv set notes post:1 '{"title":"New"}' --local --if-version 3
quant kv set notes api:token '"abc123"' --local --secret
quant kv delete notes post:1 --local
```

Flags:

- `--local` - Use the local store of `quant serve`. Without it, the command prints `Remote KV commands are not available yet. Use --local.`
- `--prefix` - `list`: key prefix.
- `--collection` - `list`: collection.
- `--index` - `list`: index name.
- `--equals` - `list`: `field=value` for the index. Repeat the flag for more fields.
- `--if-version` - `set`: write only if the key has this version.
- `--secret` - `set`: store the value encrypted, as `set(key, value, { secret: true })` in a function does. A function reads the value as usual. `list` shows `encrypted: true` and the value `[ENCRYPTED]`. `set` prints the entry with the value `[ENCRYPTED]`, so the value does not go into the terminal output or CI logs. `get --local` shows the value, because the local store is yours. The value is a command argument, so it goes into your shell history; the interactive menu asks for a secret value with hidden input. With `get`, `list` or `delete`, `--secret` is ignored and the command prints one notice. A key in an indexed collection cannot hold a secret (`INDEX_FIELD_ENCRYPTED`). The local store uses local keys only: do not put production secrets in it.
- `--org` - Organisation (default: `org` in `quant/serve.json`, the `quant.json` clientid, then `local`).
- `--project` - Project (default: `project` in `quant/serve.json`, the `quant.json` project, then `dev`).
- `--meta` - Template metadata with the KV stores (default: `meta` in `quant/serve.json`, then `quant/meta.json`).

To set these defaults one time for a project, put them in `quant/serve.json` (see [Local project settings](#local-project-settings-quantservejson)).

## Local ledgers

`quant serve` can run KV ledgers locally. Functions use the ledger methods of `kvStore` as on the edge: `append`, `ledgerStatus`, `ledgerProof`, and `list` with `collection`, `since` and `until`.

Declare the local ledgers in `quant/kv-ledgers.json`. Each key is a store name from `quant/meta.json`. Each value is a list of ledger definitions:

```json
{
  "audit": [
    { "name": "events", "collection": "events", "chains": 1, "retentionDays": 30 }
  ]
}
```

Each definition has `name`, `collection`, `chains` and `retentionDays`. The optional fields are `lockMode` (`governance` or `compliance`), `personalFields`, `subjectField`, `subjectMode` (`pseudonym` or `clear`, default `pseudonym`), `subjectCase` (`exact` or `fold`, default `exact`) and `anchor` (`{ "type": "none" }`, `customer-bucket` or `rfc3161`). `subjectMode` and `subjectCase` need `subjectField`. If a definition is not valid, `quant serve` stops with `quant/kv-ledgers.json <store> entry <n>: <message>`.

Only `quant serve` reads `quant/kv-ledgers.json`. A deploy never reads it. In production, declare ledgers with the API or the portal.

With `--clock real` (the default), a ledger in this file is active when `quant serve` starts: quant serve skips the activation delay of the platform. With `--clock manual`, a new ledger stays pending until the activation delay has passed on the manual clock, so you can test `LEDGER_NOT_READY`. Move the clock forward to activate it. A ledger that a `--clock manual` session declared can still be pending in a later `--clock real` start. Quant serve then prints a warning with the time when the ledger becomes active. Run `quant serve --reset` to declare it again.

With `--watch`, quant serve reads `quant/kv-ledgers.json` again when it changes and declares the new ledgers. If the file is not valid, quant serve prints the error and keeps the ledgers that it has.

The ledger and its entries stay in the local KV state. If you change a definition, quant serve keeps the old one and prints a warning. If you remove a ledger from the file, the ledger stays in the local state. Run `quant serve --reset` to declare the ledgers again.

A proof is `pending` until its entry is in an archive. The local archives run on the KV time. To get an archived proof at once, use the control route. The routes answer only a loopback client, only the Host names `localhost`, `127.0.0.1` and `[::1]`, and only a request with the header `x-quant-serve: 1` (see [Safety](#safety)):

```bash
# Archive every ledger entry of the store now
curl -X POST http://127.0.0.1:8787/_quant_serve/ledger/archive-now \
  -H 'x-quant-serve: 1' -H 'content-type: application/json' -d '{"store":"audit"}'

# With --clock manual: move the time forward 10 minutes, or set it (epoch ms)
curl -X POST http://127.0.0.1:8787/_quant_serve/clock \
  -H 'x-quant-serve: 1' -H 'content-type: application/json' -d '{"advanceMs":600000}'
curl -X POST http://127.0.0.1:8787/_quant_serve/clock \
  -H 'x-quant-serve: 1' -H 'content-type: application/json' -d '{"setMs":1798761600000}'

# The clock mode, the KV time and the public key that signs local proofs
curl http://127.0.0.1:8787/_quant_serve/info -H 'x-quant-serve: 1'
```

- `archive-now` answers `{ "archived": true }`, and 404 for a store that `quant/meta.json` does not declare.
- `clock` answers `{ "now": <epoch ms> }`. With `--clock real`, it answers 409. A new time past the Date range (8.64e15 ms) gets 400. A `setMs` can move the time back, but a new ledger entry never gets an earlier time than the last entry.
- The time that `clock` sets stays in the local KV state. A restart with `--clock manual` keeps it. A start with `--clock real` sets the KV time back to the real time and prints `The local clock offset was cleared (--clock real).`
- A local proof is signed with a local key. Verify it with the `publicKey` from `/_quant_serve/info`. A local key never verifies a production proof. The offline verifier is in the conformance suite, which installs from GitHub (it is not on the npm registry):

  ```bash
  npm install --save-dev github:quantcdn/kv-ledger-conformance#edge-kv-v0.2.0
  npx kv-ledger-verify verify-proof proof.json --public-key key.pem
  ```

`quant kv --local` does not have ledger commands yet. It prints a warning to stderr for a pending ledger and for a ledger in a retired format.

### Ledger subjects

A ledger with a `subjectField` names a data subject in each entry. Quant serve emulates version 1 of the ledger subject contract with `@quantcdn/edge-kv`:

- `pseudonym` mode stores a token in the subject field. `clear` mode keeps the field as given. In both modes, the personal fields are sealed with a key for each subject.
- Reads of an entry show the value as appended. After a shred, each sealed field reads `{ "$shredded": true }`.

The local control route has the two subject calls. They take the body of the platform admin routes, and they answer the platform answer body. In production, these are admin API calls (`POST …/ledgers/{name}/shred` and `POST …/ledgers/{name}/subject-entries`). The edge `kvStore` does not have them.

```bash
# Shred a data subject: shred entries, then the subject key is destroyed. The answer holds a signed receipt.
curl -X POST http://127.0.0.1:8787/_quant_serve/ledger/shred \
  -H 'x-quant-serve: 1' -H 'content-type: application/json' \
  -d '{"store":"audit","ledger":"people","subjectId":"u-17","reason":"Erasure request 1","authority":"Policy 4","requestedBy":"Privacy officer"}'

# The entries of one data subject (optional: collection, since, until, limit, nextToken, personal)
curl -X POST http://127.0.0.1:8787/_quant_serve/ledger/subject-entries \
  -H 'x-quant-serve: 1' -H 'content-type: application/json' \
  -d '{"store":"audit","ledger":"people","subjectId":"u-17"}'
```

- A store that `quant/meta.json` does not declare gets 404. A body that is not a JSON object with `store` and `ledger` gets 400.
- A backend error answers its status and `{ "code", "message" }`, for example 404 `LEDGER_NOT_FOUND` or 400 `VALIDATION`.
- A repeat shred answers `alreadyShredded: true` with the same receipt. The receipt is signed with the local key, the `publicKey` from `/_quant_serve/info`.

A ledger with a `subjectField` that an earlier quant serve (edge-kv 0.1.x) declared has no `subjectMode`. Its appends and reads now give `LEDGER_FORMAT_RETIRED`, as on the platform. Quant serve prints a warning that names the ledger at start. Run `quant serve --reset`, or declare a new ledger.

> **Caution:** The subject keys are local keys in `.quant/kv/state.json`, not KMS keys. Anyone who can read the state file can read every personal field, also a shredded field in an older copy of the file. Never put real personal data in the local KV.

## Inline functions

`quant serve` replaces `{{QUANT_FN:uuid}}` tokens in pages, as the edge does, when `quant/meta.json` turns inline functions on:

```json
{
  "project_settings": {
    "enable_inline_fn": true
  }
}
```

`project_settings` accepts only `enable_inline_fn`, with `true` or `false`. A file with another key or value stops `quant serve` with the message that the portal shows.

- Tokens are replaced in static HTML pages with status 200, and in HTML pages with status 200 from the `--proxy` dev server. Tokens in other files, function responses and the 404 page stay as they are.
- The token must hold a full function UUID. Any other text between the braces stays in the page. The token is not case sensitive.
- Each function runs once, in the order of its first token, one at a time. Every copy of its token is replaced by the function body as text. The status of the function does not change the page status.
- A token for a UUID with no function in `quant/edge-functions.json` is replaced by `Unable to find edge function with uuid: <uuid>`.
- The output of a function is not scanned for tokens.
- A content filter runs before the tokens are replaced.
- The function gets the page request: `event.request` and `event.url` are the page request and URL.
- A page with a token gets `content-type: text/html; charset=utf-8`, and loses `etag` and `last-modified`. The headers of the last function that ran are added. Without a `cache-control` from the function (or from `globalHeaders`), the page gets `cache-control: private, max-age=0`.

What is different from the edge:

- On the edge, a page with inline functions on also gets a client script for `<quant-island>` elements. `quant serve` does not add this script.
- The "Allow Inline Functions" option of a proxy rule is not in the rules manifest, so `quant serve` does not process proxy rule responses.
- If a function fails, the terminal shows the error, and the token is replaced by an empty string.
- A page over 10 MB is sent without inline function output, and a function output over 10 MB is replaced by an empty string. The terminal shows a warning.

## Local project settings (quant/serve.json)

On a real project, the dashboard sets the custom headers, basic authentication and the trailing-slash behaviour. `quant serve` reads these settings from `quant/serve.json`:

```json
{
  "globalHeaders": {
    "x-frame-options": "DENY",
    "cache-control": "public, max-age=60"
  },
  "basicAuth": { "username": "demo", "password": "local-only" },
  "trailingSlash": "redirect"
}
```

Each field is optional.

- `globalHeaders` - Headers for every response from the site: pages, files, function responses, the 404 page and the basic authentication 401. A header that a function sets replaces the global header of the same name. `quant-server` and `age` cannot be set.
- `basicAuth` - With a username and a password, every path needs these credentials. A request without them gets 401 with `WWW-Authenticate: Basic`. The check applies before the rules, so functions and redirects need the credentials too. WebSocket upgrades also need them. The `/_quant_serve/` control routes do not need them: they are local only and need the `x-quant-serve: 1` header (see [Safety](#safety)).
- `trailingSlash` - `"redirect"`: a path that ends with `/` (except `/`) gets a 301 to the path without the trailing slashes, with the query string. A path that a rule answers is not redirected. `"none"` (the default): no redirect.
- `org`, `project` - The organisation and the project for the local KV store ids, for `quant serve` and `quant kv --local`. Use them when the project has no `quant.json`. Each value is 1 to 100 letters, digits, `.`, `_` or `-`.
- `meta` - The template metadata file with the KV stores (default: `quant/meta.json`). The path is relative to the project directory and must stay in it.

For `org`, `project` and `meta`, the order is: the flag, then `quant/serve.json`, then `quant.json` (org and project only), then the default (`local`, `dev`, `quant/meta.json`). `quant serve` reads these three fields only at start-up, also with `--watch`. If `quant/serve.json` and `quant.json` set a different org (or project) and no flag chooses, `quant serve` and `quant kv --local` print one warning line that names the value they use.

The local store ids contain the org and the project (for example `local-dev-orbit`). If you add or change `org` or `project` in `quant/serve.json`, the store ids change (for example to `acme-dev-orbit`), and the local data that you wrote before seems to be missing. The data is still in `.quant/kv/`. Set the old values again to see it.

```json
{ "org": "acme", "project": "marketing-site" }
```

The order is the order of the edge: global headers, basic authentication, rules, the trailing-slash redirect, then static content.

`quant/serve.json` is local only. No deploy command reads it, and `quant deploy` never uploads it. `quant serve` never prints the password. Do not put a production password in the file. A file with the wrong shape stops `quant serve` at start-up, with a message that names the field. It also stops `quant kv --local` (exit code 1), because that command reads the `org`, `project` and `meta` defaults from the same file. With `--watch`, `quant serve` reads the file again when it changes. If the new file has the wrong shape, `quant serve` prints the message and keeps the last valid settings.

## Portal rules and remote KV

Two flags read data from the portal project when `quant serve` starts: `--pull-rules` for the rules and global headers, and `--kv-remote <name>` for one KV store. Use them to run the site locally against the rules and data of a real project. Both flags only read. Neither flag changes anything on the portal.

```bash
export QUANT_API_TOKEN=...   # a portal token with the scopes below
export QUANT_BASE_URL=https://dashboard.quantcdn.io/api/v2
quant serve dist --pull-rules --kv-remote sessions --org acme --project marketing-site
```

### Token, URL and project

- `QUANT_API_TOKEN` and `QUANT_BASE_URL` are the only source of the token and the portal URL. There is no flag for either, and `quant serve` never prints the token.
- `QUANT_BASE_URL` must be an HTTPS portal `/api/v2` URL. Plain HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`.
- The organisation and project come from `--org` and `--project`, then `quant/serve.json`, then `quant.json`. If none sets them, the command stops with a message that names the flag.
- Scopes: `rules:read` for the rules, `projects:read` for the global headers, and `kv:read` for the KV store. Without `rules:read` or `kv:read`, `quant serve` stops and the message names the scope. Without `projects:read`, `quant serve` prints one warning and uses only the local global headers.

### What the snapshot is

- The portal is read once, at start. Nothing is read again while `quant serve` runs. With `--watch`, a reload merges the local files again with the data in memory and makes no portal request.
- The rules, the headers and the KV entries stay in memory. `quant serve` does not write them to `.quant/` or to any other file, and it does not print a rule setting or a KV value.
- Writes to the remote store stay local. They last for the session and they are lost when `quant serve` stops. A restart reads the portal again.

### Rules (--pull-rules)

The pulled rules run in the order of the edge, with the rules of `quant/edge-rules.json`. The rules that a deploy of `quant/edge-rules.json` owns on the portal are replaced by the local rules. Each local rule goes before the first portal rule with a higher weight. This is the order that the edge has after a deploy of the same file.

The start-up output shows `Pulled <n> portal rules (<m> from quant/edge-rules.json).`. `<m>` is the number of local rules that run with the portal rules.

Actions that run locally: redirect (with `$1` to `$5`), headers, custom response, basic auth, error page, proxy, and edge function, auth function and filter rules. A rule with a cookie condition runs only when the request sends a cookie of exactly that name.

These do not run locally:

- A rule action that quant serve does not have (for example a bot challenge or serve-static). `quant serve` skips the rule and prints `Rule <name> (<action>) is not available in quant serve and is skipped.`
- A rule with a country, IP, ASN, user agent or traffic source condition. `quant serve` skips the rule and prints `Rule <name>: the <condition> condition is not checked in quant serve, so the rule is skipped.` (one condition) or `Rule <name>: the <condition>, <condition> conditions are not checked in quant serve, so the rule is skipped.` (more than one).
- The WAF settings of a proxy rule. `quant serve` prints `Rule <name>: WAF settings are ignored in quant serve.`
- The host setting of a proxy rule. The origin gets the host of the `to` URL, and `quant serve` prints `Rule <name>: the host setting is ignored in quant serve. The origin gets the host of the to URL.`
- The failover mode and TLS verification settings of a proxy rule. `quant serve` prints `Rule <name>: failover and TLS verification settings work differently in quant serve.`

Other points:

- Some organisations (for example trial organisations) do not get every rule type in the portal list. `quant serve` then prints `Some rule types are not in the portal response for this organisation, so they do not run locally.`, and the missing rules do not run.
- Basic authentication for the whole site and the trailing-slash setting have no portal read route. They come only from `quant/serve.json`.
- The `globalHeaders` of `quant/serve.json` replace a portal global header of the same name, with one warning for each name.
- A pulled function rule runs only when its function uuid is in `quant/edge-functions.json`. The function code is not pulled.

### Remote KV (--kv-remote)

`--kv-remote <name>` copies the KV store `<name>` into the local KV, in memory. The store must be linked to the portal project and listed in `quant/meta.json`, so that functions can open it. The `initial_values` and fixtures of that store are not seeded.

- Caps: at most 10,000 keys and 200 portal requests. If a cap stops the read, `quant serve` prints `KV store <name>: copied the first <n> keys only (limit 10000). Writes stay local.`. For the request cap, the text in the brackets is `request limit 200`. If the portal ends the key list early, it is `the portal ended the list early`.
- The start-up output shows `KV store <name>: copied <n> keys from the portal (<m> encrypted values masked).` If the portal store has ledger entries, the line adds ` (<k> ledger entries not copied)` before the final full stop.
- A secret value reads `[ENCRYPTED]`. The portal does not send the real value.
- Index definitions are copied, so index lists and counts work. Expiry times are kept.
- Ledger entries are not copied. If `quant/kv-ledgers.json` declares ledgers for the store, those ledgers run locally and start empty, and `quant serve` prints `Ledgers of <name> are not copied from the portal; declare local ledgers in quant/kv-ledgers.json.`
- `quant kv --local` in a second process does not see the snapshot. It sees only the state on disk.

## Edge libraries in quant serve

The Quant edge gives functions a set of library globals. In `quant serve`, each library global comes from your project. Install the package in the project, and the global uses it.

```bash
npm install jose
```

If the package is not installed, the global exists but throws when a function uses it. The message reads `<name> is available on the Quant edge but not in quant serve`. The start-up output lists the libraries that quant serve found in the project.

## Declare KV indexes

`quant kv-indexes` reads the KV stores in `quant/meta.json`. It declares each index that the portal does not have yet. It does not change an index that exists.

```bash
export QUANT_API_TOKEN=...
export QUANT_BASE_URL=https://dashboard.quantcdn.io/api/v2
quant kv-indexes -c my-org -p my-project --dry-run
quant kv-indexes -c my-org -p my-project
```

`QUANT_BASE_URL` is the portal `/api/v2` URL: `https://dashboard.quantcdn.io/api/v2` for QuantCDN, `https://dash.quantgov.cloud/api/v2` for QuantGov. The organisation (`-c`) and the project (`-p`) are required; without them, the command reads them from `quant.json`.

Each line shows `<store>/<index>` and one status:

- `declared` - The command declared the index (with `--dry-run`, it would declare it).
- `ready` - The index exists, matches `meta.json` and is active.
- `building` - The index exists and the portal still builds it.
- `failed` - The index build failed, or the portal drops the index.
- `conflict` - The index exists with a different definition from `meta.json`.

If a status is `failed` or `conflict`, the command exits with an error. If no store declares an index, it prints `No KV indexes declared`.

Use a project-scoped portal API token. The token needs `kv:read` and `kv:write`. If the token lacks the scope, the command prints a warning that the indexes were not declared, and it exits with code 0. With `--strict`, it exits with code 1.

Flags:

- `[meta]` - Template metadata with the KV stores (default: `quant/meta.json`).
- `--api-token` - Scoped portal token. Prefer the `QUANT_API_TOKEN` variable.
- `--api-base-url` - Portal `/api/v2` URL. You can set `QUANT_BASE_URL` instead.
- `--dry-run` - Report what the command would declare, and declare nothing (default: off).

## What quant serve does not emulate

- Scheduled functions do not run.
- Production security protections do not apply.
- Time, memory and capacity limits of production are not the same.
- Geolocation and the client address are simulated values. Set them with `--geo` and `--client-ip`.
- Ledger subject keys are local keys, not KMS keys. There are no backups, no reference key rotation, and a shred always finishes at once (no 202 answer).

### Safety

- `quant serve` runs functions in `node:vm`. `node:vm` is not a security boundary. Run only your own code.
- A library from your project can be a different version from the one on the edge.
- A function that blocks the event loop (an endless loop after an await) stops `quant serve` after 20 s.
- The timers that a function starts (`setTimeout`, `setInterval`) are cleared when its response is ready or its time budget ends.
- When `--host` is a loopback address (the default), `quant serve` answers only the Host names `localhost`, `127.0.0.1` and `[::1]` (any port) and the `--domain` value. Other Host names get 421.
- The `/_quant_serve/` routes (`info`, `clock`, `ledger/archive-now`, `ledger/shred`, `ledger/subject-entries`) answer only a client on a loopback address, and only the Host names `localhost`, `127.0.0.1` and `[::1]` (any port). This also applies with a `--host` that is not loopback, and the `--domain` value does not count. Another Host gets 421. A request without the header `x-quant-serve: 1`, or with an `Origin` that is not a local origin (`http` or `https` on one of these names), gets 403. The routes do not exist on the edge.
- `quant serve` does not serve `quant.json`, the `quant/` folder, `quant/serve.json` and `quant/kv-ledgers.json` at any depth in the site (a deploy never uploads them), `node_modules`, or files and folders whose names start with `.`. It serves the `.well-known/` folder at the top of the site (for example `security.txt`), but not a dotfile inside it.

## Upgrading from 6.x to 7.0.0

7.0.0 is a breaking release for edge functions only:

- Every entry in a functions manifest needs an explicit `uuid`. 6.x derived a
  UUID from `id` when `uuid` was missing; 7.0.0 refuses the manifest before any
  upload and names each entry. To keep a function that 6.x deployed by `id`,
  copy its UUID from the dashboard (Compute > Edge Functions) into the entry.
  6.x derived it from the customer, the project and the `id`, so you can also
  print it locally:
  ```bash
  node -e 'const h=require("crypto").createHash("sha256").update(JSON.stringify(process.argv.slice(1,4))).digest("hex");console.log(`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`)' CUSTOMER PROJECT FUNCTION_ID
  ```
  A Studio branch environment is its own project, so 6.x gave it a different
  UUID than its parent: commit the parent's UUID.
- `quant function`, `quant auth` and `quant filter` require the `<uuid>`
  argument. Without one, 6.x created a new function on every run.
- `uuid` values are checked for shape only (8-4-4-4-12 hex), so existing UUIDs
  with any version digit keep working.
- The whole manifest is checked against the full schema before any upload,
  the same check the Quant portal uses: `type` must be lowercase (`function`,
  `edge`, `auth` or `filter`), `description` must not be blank, `uuid` and `id`
  must be unique, and every entry must be an object. 6.x accepted some of these.
- `quant function`, `quant auth` and `quant filter` now print
  `Deployed <kind> [<uuid>]` (6.x printed `Created ...` or `Updated ...`).
- New: `quant functions-add` adds an entry with a new UUID.

Pipelines that use deploy-action `v6` keep CLI 6.3.0 and are not affected.

## Testing

```bash
npm run lint
npm run test
npm run test:conformance   # the conformance suites (not part of npm run test)
```

## Contributing

Issues and feature requests are managed via Github and pull requests are welcomed.

### Deploy edge rules with a project-scoped portal token

```sh
# QUANT_API_TOKEN: separate project-scoped token with projects:read,
# rules:read and rules:write. QUANT_BASE_URL: the owning portal's /api/v2 URL.
quant rules quant/edge-rules.json --functions quant/edge-functions.json -c CUSTOMER -p PROJECT --dry-run
quant functions quant/edge-functions.json -c CUSTOMER -p PROJECT
quant rules quant/edge-rules.json --functions quant/edge-functions.json -c CUSTOMER -p PROJECT
```

`quant rules` never uses your content write token or upload endpoint. It requires
an explicit portal URL and will not follow redirects. `--dry-run` validates
permissions and previews changes without writing rules.

Rules JSON uses `version: 1`, a stable `namespace`, and a `rules` array. Each rule
has a stable `id`, `type` (`function`, `auth`, or `filter`), `urls`, an explicit
numeric `weight` (lower runs first), and either `function_ref` or `function_uuid`.
Optional fields are `name`, `domains`, `methods`, and `disabled`.
`function_ref` resolves an `id` in the functions manifest, with matching type, to
that entry's `uuid`. The functions manifest is checked the same way as by
`quant functions`. A function a rule references needs an RFC 4122 UUID
(version 1-5), because the rules API requires one; `quant functions-add`
writes version 4 UUIDs. Use `function_uuid` only for a function the manifest
does not define.

```json
{
  "version": 1,
  "namespace": "orbit",
  "rules": [{"id":"api","type":"function","urls":["/api/*"],"weight":10,"function_ref":"orbit-api-v1"}]
}
```

Deploys update only entries with matching namespace/ID and preserve other rules.
Omitted entries are preserved; disable a rule explicitly with `disabled: true`.
Place authentication rules before the functions they protect using lower weights;
weights from -100000 to 100000 are allowed, and a negative weight runs before any
rule added in the dashboard or API.

Rules deployed this way are managed in code: the dashboard and the rules API show
them read-only. If one was changed outside code anyway, the deploy writes nothing,
exits non-zero and lists each changed field (values only for matchers and weight).
Re-run with `--force` to overwrite those rules with the manifest. `--force` never
takes over a rule this manifest did not create (a rule ID collision).

When the rules API refuses a deploy with 409 or 422 and gives a message, `quant rules`
prints that message and exits non-zero. Examples:

- 409: the change may already be live. Reload the rules and check them. A retry is safe.
- 422: the requested rule order cannot be kept. A retry does not help. Contact support.

Without a message, a 409 means another request is changing the rules (retry shortly).

Portal-issued template tokens expire after one year; rotate the token and update
`QUANT_API_TOKEN` before expiry.

### Container security rebuilds

The Docker image uses a fixed-vendor Node runtime floor, a locked production-only
dependency tree and independently updated npm tooling. The `image.yml` workflow
can rebuild the current CLI version for container security updates without
changing the CLI API or publishing a new npm package. The supplied image version
must match package.json. Digest-pinned action consumers must update their image
reference after a security rebuild.
