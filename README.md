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
- `quant waf:logs` - Access project WAF logs
  ```bash
  quant waf:logs [--fields=field1,field2] [--output=file.csv] [--all] [--size=10]
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
