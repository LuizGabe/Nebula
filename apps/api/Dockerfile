FROM node:20-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json


FROM base AS deps
RUN pnpm install --frozen-lockfile --filter api


FROM deps AS dev
ENV NODE_ENV=development
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm exec prisma generate
EXPOSE 3333
CMD ["pnpm", "run", "dev"]


FROM deps AS production
ENV NODE_ENV=production
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm exec prisma generate
EXPOSE 3333
CMD ["pnpm", "run", "start"]
