# QuantCDN cli

[![Codefresh build status]( https://g.codefresh.io/api/badges/pipeline/quantcdn/QuantCDN%2Fquant-cli?key=eyJhbGciOiJIUzI1NiJ9.NWU5ZDVmZmE1MWJmOTZjYTU0NWRiNTBk.2vLiCtkYTfWcwAbwbzuL5KlwSrZRXetNTXgpWn5ZMag&type=cf-1)]( https%3A%2F%2Fg.codefresh.io%2Fpipelines%2Fquant-cli%2Fbuilds%3Ffilter%3Dtrigger%3Abuild~Build%3Bpipeline%3A5ea3dca2e2365774c68179e7~quant-cli)

Simplify deployments and interactions with the QuantCDN API by using the support cli tool.

## Install

The preferred method for installation is via npm.

```
npm i -g @quantcdn/quant-cli
```

or locally to a project

```
npm i -D @quantcdn/quant-cli
```

## Usage

```
$ quant <command>

Commands:
  quant crawl [domain]                               Crawl and push an entire domain
  quant delete <path>                                Delete a deployed path from Quant
  quant deploy [dir]                                 Deploy the output of a static generator
  quant file <file> <location>                       Deploy a single asset
  quant info                                         Give info based on current configuration
  quant init                                         Initialise a project in the current directory
  quant page <file> <location>                       Make a local page asset available via Quant
  quant proxy <path> <origin> [status]               Create a proxy to allow traffic directly to origin
  [basicAuthUser] [basicAuthPass]
  quant purge <path>                                 Purge the cache for a given url
  quant redirect <from> <to> [status] [author]       Create a redirect
  quant search <index|unindex|clear>                 Perform search index operations
  quant unpublish <path>                             Unpublish an asset

Options:
  --version       Show version number                                                      [boolean]
  --help          Show help                                                                [boolean]
  --clientid, -c  Project customer id for QuantCDN                                          [string]
  --project, -p   Project name for QuantCDN                                                 [string]
  --token, -t     Project token for QuantCDN                                                [string]
  --endpoint, -e  API endpoint for QuantCDN            [string] [default: "https://api.quantcdn.io"]
```

## Get started

Please refer to the ["get started" guide](https://docs.quantcdn.io/docs/cli/get-started) for more details on getting set up.

Quant accepts options or will ready configuration values from a `quant.json` file in the current directory.

```
$ quant init
```

An interactive walk-through for configuring your API connection.

```
$ quant info

Endpoint: https://api.quantcdn.io/v1
Customer: quant
Project: dev-docs
Token: ****
✅✅✅ Successfully connected to dev-docs
```

## Manage search index

### Basic usage

* Use `quant search status` to retrieve index size and basic configuration.
* Use `quant search unindex --path=/url/path` to remove an item from the index.
* Use `quant search clear` to clear the entire index.

### Create and update records

You may index new content or update existing content in the search index directly. Simply provide one or multiple records in JSON files. For example, consider a `search-records.json` file containing the following:

```
[
    {
        "title": "This is a record",
        "url": "/blog/page",
        "summary": "The record is small and neat.",
        "content": "Lots of good content here. But not too much!",
    },
    {
        "title": "Fully featured search record",
        "url": "/about-us",
        "summary": "The record contains all the trimmings.",
        "content": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras id dolor facilisis, ornare erat et, scelerisque odio. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
        "image": "https://www.example.com/images/about.jpg",
        "categories": [ "Blog", "Commerce", "Jamstack" ],
        "tags": [ "Tailwind" , "QuantCDN" ]
    }
]
```

To post these records to the search index:
```
quant search index --path=./search-records.json
```

**Note:** The path may either refer to an individual file or a path on disk containing multiple JSON files.

## Testing

Automated via CodeFresh for all PRs and mainline branches.

```
$ npm run lint
$ npm run test
```

## Contributing

Issues and feature requests are managed via Github and pull requests are welcomed.
