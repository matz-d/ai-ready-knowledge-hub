FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

# NEXT_PUBLIC_* は Next.js build 時にクライアントへ焼き込まれる。Cloud Run の runtime
# env では切り替えできないため、deploy workflow から build-arg で渡す。
ARG NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=false
ENV NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=$NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED
# Cloud Build の Docker build は Node 既定 heap だと Next.js typecheck が OOM になる。
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && pnpm build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/sample-data ./sample-data

# Cloud Tasks SDK loads proto JSON dynamically, so Next.js standalone tracing misses it.
COPY --from=builder /app/node_modules/.pnpm/@google-cloud+tasks@*/node_modules/@google-cloud/tasks/build/protos /tmp/cloud-tasks-protos
RUN set -eux; \
  protos_dir="$(dirname "$(find ./node_modules/.pnpm -path '*/node_modules/@google-cloud/tasks/build/protos/protos.js' -print -quit)")"; \
  test -n "$protos_dir"; \
  cp -a /tmp/cloud-tasks-protos/. "$protos_dir/"; \
  chown -R nextjs:nodejs "$protos_dir"; \
  rm -rf /tmp/cloud-tasks-protos

# pdfjs worker is not bundled into standalone; place it beside pdf.mjs in the pnpm tree.
COPY --from=builder /app/node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs /tmp/pdf.worker.mjs
RUN set -eux; \
  worker_dir="$(dirname "$(find ./node_modules/.pnpm -path '*/node_modules/pdfjs-dist/legacy/build/pdf.mjs' -print -quit)")"; \
  test -n "$worker_dir"; \
  cp /tmp/pdf.worker.mjs "$worker_dir/pdf.worker.mjs"; \
  chown nextjs:nodejs "$worker_dir/pdf.worker.mjs"; \
  rm /tmp/pdf.worker.mjs

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
