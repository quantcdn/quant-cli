FROM node:14-alpine3.10

COPY . /quant-cli
RUN npm i -g ./quant-cli

ENV NODE_OPTIONS=--max-old-space-size=8192

ENTRYPOINT [ "quant" ]
