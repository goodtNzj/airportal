#!/bin/sh
set -e

# Fix ownership on bind-mounted / volume directories that may be owned by root.
# These paths are overlaid at runtime; the Dockerfile chown only affects the image
# layer, so we do it at container start as root before dropping privileges.
for dir in /app/uploads /app/packages/server/prisma/data /web-dist /app/logs; do
    if [ -d "$dir" ]; then
        chown -R node:node "$dir" 2>/dev/null || true
    fi
done

# Clean up stale healthcheck files
rm -f /app/health /app/health.*

# Copy web dist to shared volume (for nginx to serve)
cp -r /app/packages/web/dist/. /web-dist/

# Initialize database schema (only creates tables if they don't exist).
# Runs as root because bind-mounted ./data may have root ownership on host;
# prisma creates the .db file if it doesn't exist, so we fix ownership below.
cd /app/packages/server
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss

cd /app

# Fix ownership again after prisma db push (may have created .db file as root).
for dir in /app/uploads /app/packages/server/prisma/data /web-dist /app/logs; do
    if [ -d "$dir" ]; then
        chown -R node:node "$dir" 2>/dev/null || true
    fi
done

# Drop to node user and run the main command
exec su-exec node:node "$@"
