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
  quant deploy [dir] [--attachments] [--skip-unpublish] [--chunk-size=10] [--force]
  ```

- `quant file <file> <location>` - Deploy a single asset
  ```bash
  quant file path/to/file.jpg /images/file.jpg
  ```

- `quant page <file> <location>` - Make a local page asset available
  ```bash
  quant page path/to/page.html /about-us
  ```

### Publishing Controls
- `quant publish <path>` - Publish an asset
  ```bash
  quant publish /about-us [--revision=latest]
  ```

- `quant unpublish <path>` - Unpublish an asset
  ```bash
  quant unpublish /about-us [--force]
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
--endpoint, -e    API endpoint for QuantCDN (default: "https://api.quantcdn.io")
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

# Check deployment status
quant scan --diff-only
```

## Testing

```bash
npm run lint
npm run test
```

## Contributing

Issues and feature requests are managed via Github and pull requests are welcomed.