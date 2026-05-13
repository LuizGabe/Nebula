FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy root configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy packages
COPY apps/api/ apps/api/
COPY packages/ packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate prisma client
RUN cd apps/api && pnpm exec prisma generate

WORKDIR /app/apps/api

EXPOSE 3333

CMD ["pnpm", "run", "start"]
