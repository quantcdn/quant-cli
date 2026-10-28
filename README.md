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

```bash
quant serve                                  # serve ./dist at http://127.0.0.1:8787
quant serve public --port 9000
quant serve --build "npm run build"          # build once, then serve
quant serve --build "npm run build" --watch  # build again when src/ or public/ changes
quant serve --run "npm run dev" --proxy http://localhost:4321
quant serve --memory --seed-key $(openssl rand -hex 32)
quant serve --indexes building --kv-lag 500
quant serve --reset
quant serve --version-info
```

Quant serve reads these files from the project directory: `quant/edge-functions.json`, `quant/edge-rules.json`, `quant/meta.json` and the KV fixtures. It reads `quant.json` only for the organisation and the project.

Flags:

- `[dir]` - The built site (default: `dist`).
- `--port` - Port to listen on (default: `8787`).
- `--host` - Address to listen on (default: `127.0.0.1`). Any other address makes the site and its KV data reachable on the network.
- `--functions` - Functions manifest (default: `quant/edge-functions.json`).
- `--rules` - Rules manifest (default: `quant/edge-rules.json`).
- `--meta` - Template metadata with the KV stores (default: `quant/meta.json`).
- `--fixtures` - Directory of KV fixtures (default: `quant/kv-fixtures`).
- `--org` - Organisation (default: the `quant.json` clientid, then `local`).
- `--project` - Project (default: the `quant.json` project, then `dev`).
- `--domain` - Host for the domain match of rules (default: the Host of the request).
- `--user-name` - Value for `{user_name}` in KV seed values (default: `git config user.name`, then `Owner`).
- `--build` - Command to run once before the server starts.
- `--watch` - Reload when files change. With `--build`, run the build again when files under `src/` or `public/` change.
- `--run` - Long-running command, for example a dev server, to start beside the server. Quant serve stops it when it stops.
- `--proxy` - Dev server URL. Requests that no rule ends go to this URL. WebSocket upgrades (for example, HMR) also go to this URL, after the auth rules of the path. Function rules do not run for an upgrade.
- `--geo` - Geolocation fields for functions, as a JSON object.
- `--client-ip` - Client address for functions.
- `--reset` - Delete the local KV state and seed the stores again.
- `--memory` - Keep the KV state in memory. Nothing is written to disk.
- `--seed-key` - Value of the first reveal-once entry (in the first store that has one), in hex: two characters for each byte of its `generate.bytes`. The other reveal-once entries get random values.
- `--kv-lag` - Delay in milliseconds before index lists show a change (default: `0`).
- `--indexes` - Index state for the session: `active` or `building` (default: `active`). With `building`, the indexes of the stores stay in the building state.
- `--version-info` - Print the versions of the CLI and its KV and test packages, then exit.
- `--clock`, `--pull-rules`, `--kv-remote` - Not available yet. The command stops with a message.

A key that `initial_values` reveals once is shown in a box when the store is first seeded. Save the key then. Quant serve also writes it to a file under `.quant/kv/`.

## Local KV

`quant serve` keeps the KV data in `.quant/kv/` in the project directory. The folder is git-ignored. Use `--memory` to keep no files, or `--reset` to start again.

`quant kv --local` reads and writes the same data. It needs no token. A running `quant serve` sees each write. The store name is the name from `quant/meta.json`.

```bash
quant kv list notes --local
quant kv list notes --local --prefix post:
quant kv list notes --local --index by_author --equals author=ana
quant kv get notes post:1 --local
quant kv set notes post:1 '{"title":"Hello"}' --local
quant kv set notes post:1 '{"title":"New"}' --local --if-version 3
quant kv delete notes post:1 --local
```

Flags:

- `--local` - Use the local store of `quant serve`. Without it, the command prints `Remote KV commands are not available yet. Use --local.`
- `--prefix` - `list`: key prefix.
- `--collection` - `list`: collection.
- `--index` - `list`: index name.
- `--equals` - `list`: `field=value` for the index. Repeat the flag for more fields.
- `--if-version` - `set`: write only if the key has this version.
- `--org` - Organisation (default: the `quant.json` clientid, then `local`).
- `--project` - Project (default: the `quant.json` project, then `dev`).
- `--meta` - Template metadata with the KV stores (default: `quant/meta.json`).

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
export QUANT_BASE_URL=https://example.invalid/api/v2
quant kv-indexes --dry-run
quant kv-indexes
```

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
- Ledgers come in a later release.

### Safety

- `quant serve` runs functions in `node:vm`. `node:vm` is not a security boundary. Run only your own code.
- A library from your project can be a different version from the one on the edge.
- A function that blocks the event loop (an endless loop after an await) stops `quant serve` after 20 s.
- The timers that a function starts (`setTimeout`, `setInterval`) are cleared when its response is ready or its time budget ends.
- When `--host` is a loopback address (the default), `quant serve` answers only the Host names `localhost`, `127.0.0.1` and `[::1]` (any port) and the `--domain` value. Other Host names get 421.
- The `/_quant_serve/` routes answer only on loopback, and only a request with the header `x-quant-serve: 1`. They do not exist on the edge.
- `quant serve` does not serve `quant.json`, the `quant/` folder, `node_modules`, or files and folders whose names start with `.`. It serves the `.well-known/` folder at the top of the site (for example `security.txt`), but not a dotfile inside it.

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
npm run test:conformance
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

Portal-issued template tokens expire after one year; rotate the token and update
`QUANT_API_TOKEN` before expiry.
