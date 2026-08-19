FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/solana/package.json packages/solana/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace @token2022-preflight/api --include-workspace-root
COPY packages/core packages/core
COPY packages/solana packages/solana
COPY apps/api apps/api
RUN npm run build --workspace @token2022-preflight/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
