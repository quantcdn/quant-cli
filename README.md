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
- `quant purge <path>` - Purge the cache for a given URL
  ```bash
  quant purge /about-us
  ```

### Redirects
- `quant redirect <from> <to> [status] [author]` - Create a redirect
  ```bash
  quant redirect /old-page /new-page [--status=301] [--author="John Doe"]
  ```

### Search
- `quant search <operation>` - Perform search index operations
  ```bash
  quant search status
  quant search index --path=/path/to/files
  quant search unindex --path=/url/to/remove
  quant search clear
  ```

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