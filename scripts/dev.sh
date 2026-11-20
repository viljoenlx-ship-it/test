#!/usr/bin/env bash
# One command for local development: database, migrations, seed, API, and web.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine (or Docker Desktop) and run pnpm dev again." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Starting PostgreSQL..."
docker compose up -d --wait

echo "Applying migrations..."
pnpm db:migrate

echo "Seeding fictional demo tenants..."
pnpm db:seed

echo "Starting the API on http://127.0.0.1:3000, the web app on http://localhost:5173, and the control panel on http://localhost:5174/control/"
exec pnpm exec concurrently --kill-others-on-fail -n api,web,control -c blue,green,magenta \
  "pnpm --filter @omnivate/api dev" \
  "pnpm --filter @omnivate/web dev" \
  "pnpm --filter @omnivate/control-panel dev"
