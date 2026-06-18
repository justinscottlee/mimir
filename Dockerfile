# Mimir application container.
#
# This runs the Next.js dev server (so the bind-mounted source in
# docker-compose.yml still hot-reloads). It talks to the host's Docker daemon
# through the socket mounted in compose — that's what gives Workspaces real code
# execution without any in-container Docker install. dockerode speaks to the
# socket over HTTP, so no docker CLI is needed here.
FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies first for layer caching. The resulting node_modules is
# Linux-native and is preserved at runtime by an anonymous volume in compose,
# so it never collides with a node_modules built on your host OS.
COPY package.json package-lock.json ./
RUN npm ci

# Bake the source in as a fallback for running the image without a bind mount.
# In compose the working tree is mounted over this for live editing.
COPY . .

# Entrypoint applies DB migrations, then starts the dev server. Lives outside
# /app so the bind mount can't shadow it.
COPY docker-entrypoint.sh /usr/local/bin/mimir-entrypoint.sh
RUN chmod +x /usr/local/bin/mimir-entrypoint.sh

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Poll for file changes — bind-mounted source on macOS/Windows doesn't reliably
# deliver native fs events into the container, so hot reload needs polling.
ENV WATCHPACK_POLLING=true

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/mimir-entrypoint.sh"]
