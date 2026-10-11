# The web terminal on Ubuntu: every terminal it opens is a shell in this container, kept in tmux
# when the page names it. Built from the root of the serviceman repo, which holds the Terminal
# module and the vendored xterm and Vue it serves:
#
#     bin/vendor
#     docker build -f web-terminal/Dockerfile -t web-terminal .
#     docker run --rm -p 127.0.0.1:3000:3000 web-terminal

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS node

FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 tini tmux ca-certificates curl less nano procps \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# The repo's layout, so the paths the app reads its files from are the same here as in a checkout
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY modules/terminal/server ./modules/terminal/server
COPY modules/terminal/ui ./modules/terminal/ui
COPY src/main/public/vendor/vue.esm-browser.prod.js src/main/public/vendor/xterm.mjs src/main/public/vendor/addon-fit.mjs src/main/public/vendor/xterm.css ./src/main/public/vendor/
COPY web-terminal ./web-terminal
ENV SHELL=/bin/bash
# A shell whose page closed is reaped by tini, whether or not docker put its own init in front
ENV TINI_SUBREAPER=1
WORKDIR /root
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/web-terminal/index.js"]
