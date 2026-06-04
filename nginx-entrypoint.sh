#!/bin/sh
# This script runs in /docker-entrypoint.d/ before nginx starts.
# It waits for the node container to copy web dist files into the shared volume.

echo "Waiting for web dist files from node service..."
MAX_WAIT=60
WAITED=0

while [ ! -d "/web-dist/assets" ] && [ "$WAITED" -lt "$MAX_WAIT" ]; do
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ ! -d "/web-dist/assets" ]; then
    echo "ERROR: Web dist files not found after ${MAX_WAIT}s. Aborting."
    exit 1
fi

echo "Web dist ready."

# ---- Log rotation: hourly split, retain 3 days (72 hours) ----
# Runs as a background process alongside nginx
(
    echo "Log rotation started (hourly, 3-day retention)"
    while true; do
        sleep 3600
        TIMESTAMP=$(date +%Y%m%d-%H%M%S)

        # Rotate access log
        if [ -f /var/log/nginx/access.log ]; then
            mv /var/log/nginx/access.log /var/log/nginx/access.${TIMESTAMP}.log
            gzip /var/log/nginx/access.${TIMESTAMP}.log 2>/dev/null || true
        fi

        # Rotate error log
        if [ -f /var/log/nginx/error.log ]; then
            mv /var/log/nginx/error.log /var/log/nginx/error.${TIMESTAMP}.log
            gzip /var/log/nginx/error.${TIMESTAMP}.log 2>/dev/null || true
        fi

        # Signal nginx to reopen log files
        nginx -s reopen 2>/dev/null || true

        # Delete logs older than 3 days (72 files at hourly rotation)
        find /var/log/nginx -name "*.log.gz" -mtime +2 -delete 2>/dev/null
    done
) &
