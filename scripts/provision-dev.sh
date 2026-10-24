#!/bin/sh
# One-time setup of the dev Scribe (scribe-dev.kecker.co). Safe to re-run: every step is idempotent or skipped when done.
#
#   ./scripts/provision-dev.sh
#
# Needs `npx wrangler login` first. It prompts for each secret; the values are never written to disk.
set -eu
cd "$(dirname "$0")/.."

DB=scribe-db-dev

if grep -q 'REPLACE_WITH_DEV_D1_ID' wrangler.toml; then
  echo "Creating D1 database $DB ..."
  npx wrangler d1 create "$DB"
  ID=$(npx wrangler d1 list --json | python3 -c 'import sys,json; t=sys.stdin.read(); d=json.loads(t[t.index("["):]); print([x["uuid"] for x in d if x["name"]=="'"$DB"'"][0])')
  python3 - "$ID" <<'PY'
import sys
p = "wrangler.toml"
s = open(p).read().replace("REPLACE_WITH_DEV_D1_ID", sys.argv[1])
open(p, "w").write(s)
PY
  echo "database_id written to wrangler.toml ($ID). Commit that change."
fi

echo "Applying migrations to $DB ..."
npx wrangler d1 migrations apply "$DB" --env dev --remote

for name in KINDE_CLIENT_SECRET OAUTH_PEPPER RESEND_API_KEY ANTHROPIC_API_KEY; do
  echo "Secret $name for dev (paste the value; empty to skip):"
  npx wrangler secret put "$name" --env dev || true
done

echo "Deploying dev ..."
npx wrangler deploy --env dev
echo "Done: https://scribe-dev.kecker.co/"
