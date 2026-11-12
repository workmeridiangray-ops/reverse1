FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost/build
RUN npm run build
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3100
COPY --from=build /app ./
RUN npm prune --omit=dev && useradd -r app && mkdir -p /var/lib/buildline/storage && chown -R app /var/lib/buildline /app
USER app
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
