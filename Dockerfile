# serviceman and a tailscale agent in one container, so the machine underneath carries neither
# of them. tailscaled joins the tailnet in userspace mode — no TUN device, no NET_ADMIN — and
# hands the connections it receives to serviceman on the loopback beside it. Nothing is
# published: which loopback that is depends on --net host, and docs/deploy.md says what each
# one means.
#
#     bin/build            # docker build -t serviceman .
#     bin/run              # the image as built, the machine's own network, in front of you
#
# demos/docker-compose.yml is the same image left running on a machine.
#
# The agent image beside this one (Dockerfile.agent) is the other half: a machine that carries
# services for a serviceman somewhere else.

# tailscale as its stable channel has it on the day of the build: bin/build pulls every image
# afresh, so each build takes the newest release, for whatever architecture it builds on
FROM tailscale/tailscale:stable AS tailscale

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
# No docker command line in here: the containers of a service are started by an agent, on the
# machine that is meant to carry them, so serviceman itself never runs docker
RUN apk add --no-cache ca-certificates
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY config ./config
# src/main/public links to this one, so it sits where the link points
COPY overview_remotes.json ./
COPY src ./src
# The modules (File Manager, Terminal, Docker), which src/ requires and the control page imports
COPY modules ./modules
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# On the volume, not in the image: it holds tokens, .dockerignore keeps it out of the build, and
# what the control page writes into it has to outlive a --rm container
ENV SERVICEMAN_CONFIG=/app/data/serviceman.json
# What serviceman writes down about itself sits beside its config
ENV SERVICEMAN_STATE_DIR=/app/data
ENV SERVICEMAN_LOG_DIR=/app/data/logs
ENTRYPOINT ["/app/docker-entrypoint.sh"]
