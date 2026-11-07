#!/usr/bin/env bash
# Weekly repository security agent. Run from the repo root on a runner where `agy` and `gh` are signed in.
#
#   1. agy reviews the code and applies minimal fixes on a new branch.
#   2. Guardrails: protected paths untouched, diff size capped, typecheck + tests green.
#   3. A PR is opened with gh.
#   4. A second, fresh agy session reviews the PR diff and answers SAFE or UNSAFE.
#   5. SAFE merges it (merge commit, never a force-push); UNSAFE leaves the PR open with the reasons.
#
# Environment: GH_TOKEN (required), BASE_BRANCH (default main), MAX_DIFF_LINES (default 400),
# TEST_CMD (default "npx tsc --noEmit && npx vitest run"), MERGE (default "true"; "false" opens the PR only).
set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-main}"
MAX_DIFF_LINES="${MAX_DIFF_LINES:-400}"
TEST_CMD="${TEST_CMD:-npx tsc --noEmit && npx vitest run}"
MERGE="${MERGE:-true}"
# Copy the prompts aside: the work branch is cut from origin/main, which may not have them yet.
HERE="$(mktemp -d)"
cp "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"/*.md "$HERE/"
WORK=".security-agent"
BRANCH="security/weekly-$(date -u +%Y-%m-%d-%H%M)"
PROTECTED_RE='^(\.github/|wrangler\.toml|drizzle/|migrations/|\.dev\.vars|\.env|scripts/security-agent/)'

AGY=(agy --sandbox --dangerously-skip-permissions)
mkdir -p "$WORK"
grep -qxF "$WORK/" .git/info/exclude 2>/dev/null || echo "$WORK/" >> .git/info/exclude

git config user.name "security-agent"
git config user.email "security-agent@users.noreply.github.com"
git fetch -q origin "$BASE_BRANCH"
git switch -q -c "$BRANCH" "origin/$BASE_BRANCH"

echo "::group::Baseline checks"
bash -c "$TEST_CMD"
echo "::endgroup::"

echo "::group::agy security review"
"${AGY[@]}" -p "$(cat "$HERE/fix-prompt.md")" | tee "$WORK/agent-output.txt"
echo "::endgroup::"

if [ -z "$(git status --porcelain)" ]; then
  echo "No changes proposed. Nothing to do."
  cat "$WORK/summary.md" 2>/dev/null || true
  exit 0
fi

echo "::group::Guardrails"
CHANGED="$(git status --porcelain | awk '{print $NF}')"
if echo "$CHANGED" | grep -E "$PROTECTED_RE" >/dev/null; then
  echo "Agent touched a protected path; discarding."; echo "$CHANGED" | grep -E "$PROTECTED_RE"; exit 1
fi
git add -A
LINES="$(git diff --cached --numstat | awk '{s+=$1+$2} END {print s+0}')"
if [ "$LINES" -gt "$MAX_DIFF_LINES" ]; then
  echo "Diff is $LINES lines (cap $MAX_DIFF_LINES); too large for unattended merge."; exit 1
fi
bash -c "$TEST_CMD"
echo "::endgroup::"

SUMMARY="$(cat "$WORK/summary.md" 2>/dev/null || echo 'No summary written.')"
git commit -q -m "security: weekly agent fixes

$SUMMARY

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -q origin "$BRANCH"

PR_URL="$(gh pr create --base "$BASE_BRANCH" --head "$BRANCH" \
  --title "security: weekly review fixes ($(date -u +%Y-%m-%d))" \
  --body "Opened by the weekly security agent (agy). Typecheck and tests pass.

$SUMMARY")"
echo "Opened $PR_URL"

echo "::group::Independent PR review"
git diff "origin/$BASE_BRANCH...HEAD" > "$WORK/pr.diff"
VERDICT_RAW="$("${AGY[@]}" -p "$(cat "$HERE/review-prompt.md")" | tail -n 1)"
echo "$VERDICT_RAW"
echo "::endgroup::"
VERDICT="$(echo "$VERDICT_RAW" | jq -r '.verdict' 2>/dev/null || echo UNSAFE)"
REASONS="$(echo "$VERDICT_RAW" | jq -r '(.reasons // []) | map("- " + .) | join("\n")' 2>/dev/null || echo '- unparseable reviewer output')"

gh pr comment "$PR_URL" --body "**Independent agent review: $VERDICT**

$REASONS"

if [ "$VERDICT" = "SAFE" ] && [ "$MERGE" = "true" ]; then
  gh pr merge "$PR_URL" --merge --admin --delete-branch
  echo "Merged $PR_URL"
else
  echo "Left $PR_URL open for a human (verdict: $VERDICT, merge: $MERGE)."
fi
