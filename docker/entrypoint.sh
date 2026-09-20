#!/bin/sh
set -eu

mkdir -p /app/data/media /app/data/tmp
chown -R app:app /app/data

gosu app npx prisma migrate deploy
exec gosu app "$@"
