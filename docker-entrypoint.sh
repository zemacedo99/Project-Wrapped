#!/bin/sh
# Entrypoint for the containerised app service.
# Applies the current Drizzle schema to the database, then starts the server.
#
# Notes:
# - This does NOT use `--force`, so it will never silently discard data.
#   On a brand new (empty) database this is a plain, non-interactive schema
#   creation. If a *future* schema change is ambiguous (e.g. a column rename)
#   drizzle-kit may ask for confirmation; see README.md "Database schema
#   updates" section for how to handle that case and why you should back up
#   first.
set -e

echo "[entrypoint] Waiting for database and applying schema (drizzle-kit push)..."
npx drizzle-kit push

echo "[entrypoint] Starting server..."
exec node dist/index.cjs
