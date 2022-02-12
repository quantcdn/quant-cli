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
  quant proxy <path> <origin> [status]               Create a proxy to allow traffic directly to
  [basicAuthUser] [basicAuthPass]                     origin
  quant purge <path>                                  Purge the cache for a given url
  quant redirect <from> <to> [status] [author]        Create a redirect
  quant unpublish <path>                              Unpublish an asset

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

## Testing

Automated via CodeFresh for all PRs and mainline branches.

```
$ npm run lint
$ npm run test
```

## Contributing

Issues and feature requests are managed via Github and pull requests are welcomed.
