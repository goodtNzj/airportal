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
