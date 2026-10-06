# syntax = docker/dockerfile:1

# Node runs the TypeScript in src/ directly (type stripping), so there is no
# build step: install production dependencies, copy the app, run it. The
# version matches mise.toml so local and deployed behaviour agree.
FROM docker.io/library/node:24.21.0-slim

ENV NODE_ENV=production
WORKDIR /app

# same pnpm as mise.toml, so the lockfile is read the way it was written
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY src/ src/
COPY public/ public/
COPY docs/ docs/
COPY README.md ./

# The database lives on the Fly volume mounted at /data (fly.toml); that's
# the only storage that survives a restart or redeploy.
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
