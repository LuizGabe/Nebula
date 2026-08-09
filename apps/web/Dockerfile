FROM node:20-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json


FROM base AS deps
RUN pnpm install --frozen-lockfile --filter nebula-frontend


FROM deps AS dev
ENV NODE_ENV=development
COPY apps/web apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["pnpm", "run", "dev"]


FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:3333
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN pnpm run build


FROM nginx:1.27-alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
