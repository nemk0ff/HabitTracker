FROM node:20-alpine

WORKDIR /app

# Install deps (separate layer for better caching)
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
RUN cd frontend && npm ci
RUN cd backend && npm ci

# Copy source
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build frontend → outputs to /app/backend/public (per vite.config.ts outDir)
RUN cd frontend && npm run build

# Generate Prisma client + compile TypeScript
RUN cd backend && npx prisma generate && npm run build

# process.cwd() must be /app/backend so that path.join(cwd, 'public') resolves correctly
WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# On each start: sync schema to SQLite volume, then run server
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
