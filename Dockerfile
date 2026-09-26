# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN node -e "const major=Number(process.versions.node.split('.')[0]); if (major < 22) { console.error(\"ERROR: WOS requires Node.js >=22 for current Supabase runtime\"); process.exit(1); } console.log(\"Node.js preflight OK:\", process.version)"
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build && rm -rf .next/cache

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000
CMD ["npm", "run", "start"]
