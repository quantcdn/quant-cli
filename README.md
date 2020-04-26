[![Codefresh build status]( https://g.codefresh.io/api/badges/pipeline/quantcdn/QuantCDN%2Fquant-cli?key=eyJhbGciOiJIUzI1NiJ9.NWU5ZDVmZmE1MWJmOTZjYTU0NWRiNTBk.2vLiCtkYTfWcwAbwbzuL5KlwSrZRXetNTXgpWn5ZMag&type=cf-1)]( https%3A%2F%2Fg.codefresh.io%2Fpipelines%2Fquant-cli%2Fbuilds%3Ffilter%3Dtrigger%3Abuild~Build%3Bpipeline%3A5ea3dca2e2365774c68179e7~quant-cli)

## QuantCDN NodeJS cli tool

Provides `quant` cli tool for interfacing with QuantCDN.

### Installation

`npm i -g @quantcdn/quant-cli`

### Usage

1. Initialise in any folder that contains static assets for deployment
2. Run `quant init` and provide username, token, path to static assets
3. Run `quant deploy` to push static assets to QuantCDN
