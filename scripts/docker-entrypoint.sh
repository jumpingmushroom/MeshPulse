#!/bin/sh
set -e
# Bind mounts (Unraid appdata) arrive root-owned; take ownership, then drop root.
if [ "$(id -u)" = 0 ]; then
	PUID="${PUID:-99}"
	PGID="${PGID:-100}"
	chown -R "$PUID:$PGID" /data
	exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi
exec "$@"
