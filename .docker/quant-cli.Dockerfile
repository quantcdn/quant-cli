FROM node:22-alpine

# CVE-2026-111497: the bundled Node decoder needs the fixed vendor release.
RUN node -e "const v=process.versions.node.split('.').map(Number); if(v[0]!==22 || v[1]<23 || (v[1]===23 && v[2]<4)) throw Error('Node 22.23.4 or later in Node 22 is required')"

# Keep npm tooling independently patched and install only locked runtime deps.
RUN apk upgrade --no-cache && npm install --global npm@12.2.1
# npm 12.2.1 still bundles undici 6.29.0; apply its compatible security patch.
RUN npm install --prefix /tmp/npm-security --omit=dev --ignore-scripts undici@6.29.1 && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/undici && \
    mv /tmp/npm-security/node_modules/undici /usr/local/lib/node_modules/npm/node_modules/undici && \
    rm -rf /tmp/npm-security
COPY package.json package-lock.json /quant-cli/
RUN npm ci --omit=dev --prefix /quant-cli && npm cache clean --force
COPY cli.js /quant-cli/cli.js
COPY src /quant-cli/src
RUN chmod +x /quant-cli/cli.js && ln -s /quant-cli/cli.js /usr/local/bin/quant

ENV NODE_OPTIONS=--max-old-space-size=8192
ENTRYPOINT ["quant"]
