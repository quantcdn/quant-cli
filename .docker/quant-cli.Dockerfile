FROM node:20-alpine

COPY . /quant-cli
RUN npm i -g ./quant-cli
RUN npm i --prefix /quant-cli

ENV NODE_OPTIONS=--max-old-space-size=8192

ENTRYPOINT [ "quant" ]
