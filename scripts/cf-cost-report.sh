#!/usr/bin/env bash
#
# cf-cost-report.sh — Cloudflare Account Cost & Usage Report
#
# Pulls real-time metrics from the Cloudflare GraphQL Analytics API
# and calculates estimated costs for all Workers, D1, Durable Objects,
# KV, R2, and Queues across your entire account.
#
# Prerequisites:
#   - wrangler logged in (uses OAuth token from wrangler config)
#   - jq installed (brew install jq)
#   - python3 available
#
# Usage:
#   ./scripts/cf-cost-report.sh              # Current billing month
#   ./scripts/cf-cost-report.sh 2026-03      # Specific month
#   ./scripts/cf-cost-report.sh --json       # JSON output
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────
ACCOUNT_ID="c8aee3d48dacd2d55b32209abf0da547"
WRANGLER_CONFIG="$HOME/Library/Preferences/.wrangler/config/default.toml"
CF_API="https://api.cloudflare.com/client/v4"

# ── Parse arguments ────────────────────────────────────────────────
JSON_OUTPUT=false
MONTH=""
for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
    20[0-9][0-9]-[0-9][0-9]) MONTH="$arg" ;;
    -h|--help)
      echo "Usage: $0 [YYYY-MM] [--json]"
      echo "  YYYY-MM   Billing month (default: current month)"
      echo "  --json    Output as JSON instead of table"
      exit 0
      ;;
  esac
done

# Default to current month
if [[ -z "$MONTH" ]]; then
  MONTH=$(date -u +"%Y-%m")
fi

DATE_START="${MONTH}-01T00:00:00Z"
# Calculate end of month
YEAR=${MONTH:0:4}
MON=${MONTH:5:2}
if [[ "$MON" == "12" ]]; then
  NEXT_YEAR=$((YEAR + 1))
  NEXT_MON="01"
else
  NEXT_MON=$(printf "%02d" $((10#$MON + 1)))
  NEXT_YEAR=$YEAR
fi
DATE_END="${NEXT_YEAR}-${NEXT_MON}-01T00:00:00Z"

# ── Auth ───────────────────────────────────────────────────────────
get_token() {
  if [[ -f "$WRANGLER_CONFIG" ]]; then
    grep 'oauth_token' "$WRANGLER_CONFIG" | cut -d'"' -f2
  elif [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "$CLOUDFLARE_API_TOKEN"
  else
    echo "ERROR: No auth found. Run 'wrangler login' or set CLOUDFLARE_API_TOKEN" >&2
    exit 1
  fi
}

TOKEN=$(get_token)

# ── GraphQL helper ─────────────────────────────────────────────────
gql() {
  local query="$1"
  curl -sf "$CF_API/graphql" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$query\"}" 2>/dev/null
}

# ── Fetch all metrics in a single GraphQL query ───────────────────
FILTER="filter: { datetime_geq: \\\"$DATE_START\\\", datetime_leq: \\\"$DATE_END\\\" }"

QUERY="{ viewer { accounts(filter: {accountTag: \\\"$ACCOUNT_ID\\\"}) {\
  workersInvocationsAdaptive(limit: 200, $FILTER) {\
    sum { requests subrequests errors }\
    quantiles { cpuTimeP50 cpuTimeP99 }\
    dimensions { scriptName status }\
  }\
  d1AnalyticsAdaptiveGroups(limit: 200, $FILTER) {\
    sum { readQueries writeQueries rowsRead rowsWritten queryBatchResponseBytes }\
    dimensions { databaseId }\
  }\
  durableObjectsInvocationsAdaptiveGroups(limit: 200, $FILTER) {\
    sum { requests }\
    dimensions { scriptName }\
  }\
  durableObjectsPeriodicGroups(limit: 200, $FILTER) {\
    sum { activeTime cpuTime }\
    dimensions { namespaceId }\
  }\
  durableObjectsSqlStorageGroups(limit: 200, $FILTER) {\
    max { storedBytes }\
    dimensions { namespaceId }\
  }\
  kvOperationsAdaptiveGroups(limit: 100, $FILTER) {\
    sum { requests }\
  }\
  kvStorageAdaptiveGroups(limit: 100, $FILTER) {\
    max { byteCount keyCount }\
  }\
  r2OperationsAdaptiveGroups(limit: 100, $FILTER) {\
    sum { requests }\
  }\
  r2StorageAdaptiveGroups(limit: 100, $FILTER) {\
    max { payloadSize objectCount }\
  }\
} } }"

METRICS=$(gql "$QUERY")

if [[ -z "$METRICS" ]] || echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('data') else 1)" 2>/dev/null; then
  : # success
else
  echo "ERROR: Failed to fetch metrics from Cloudflare GraphQL API" >&2
  echo "$METRICS" >&2
  exit 1
fi

# ── Fetch D1 database names ───────────────────────────────────────
D1_LIST=$(curl -sf "$CF_API/accounts/$ACCOUNT_ID/d1/database" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"result":[]}')

# ── Fetch Worker list for metadata ────────────────────────────────
WORKERS_LIST=$(curl -sf "$CF_API/accounts/$ACCOUNT_ID/workers/scripts" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"result":[]}')

# ── Calculate costs with Python ───────────────────────────────────
export METRICS D1_LIST WORKERS_LIST MONTH JSON_OUTPUT ACCOUNT_ID
python3 << 'PYEOF'
import json, sys, os

month = os.environ.get("MONTH", "unknown")
json_output = os.environ.get("JSON_OUTPUT", "false") == "true"

metrics = json.loads(os.environ["METRICS"])
d1_list = json.loads(os.environ["D1_LIST"])
workers_list = json.loads(os.environ["WORKERS_LIST"])

acct = metrics["data"]["viewer"]["accounts"][0]

# ── Pricing constants (Cloudflare Workers Paid plan) ──
PAID_BASE = 5.00

# Workers
WORKER_REQ_INCLUDED = 10_000_000
WORKER_REQ_OVERAGE = 0.30 / 1_000_000
WORKER_CPU_INCLUDED = 30_000_000_000  # 30B microseconds = 30M ms
WORKER_CPU_OVERAGE = 0.02 / 1_000_000  # per million ms

# D1
D1_ROWS_READ_INCLUDED = 25_000_000_000
D1_ROWS_READ_OVERAGE = 0.001 / 1_000_000
D1_ROWS_WRITTEN_INCLUDED = 50_000_000
D1_ROWS_WRITTEN_OVERAGE = 1.00 / 1_000_000
D1_STORAGE_INCLUDED_GB = 5
D1_STORAGE_OVERAGE = 0.75  # per GB-month

# Durable Objects
DO_REQ_INCLUDED = 1_000_000
DO_REQ_OVERAGE = 0.15 / 1_000_000
DO_DURATION_INCLUDED = 400_000  # GB-seconds
DO_DURATION_OVERAGE = 12.50 / 1_000_000  # per million GB-s
DO_SQL_STORAGE_INCLUDED_GB = 5
DO_SQL_STORAGE_OVERAGE = 0.20  # per GB-month

# Free plan limits (daily)
FREE_WORKER_REQS_DAY = 100_000
FREE_D1_READS_DAY = 5_000_000
FREE_D1_WRITES_DAY = 100_000
FREE_D1_STORAGE_GB = 5
FREE_DO_REQS_DAY = 100_000
FREE_DO_DURATION_DAY = 13_000  # GB-s

# ── Build D1 name lookup ──
d1_names = {}
for db in d1_list.get("result", []):
    d1_names[db["uuid"]] = db["name"]

# ── Build worker list ──
worker_names = []
for w in workers_list.get("result", []):
    worker_names.append(w["id"])

# ── Aggregate worker metrics ──
workers = {}
for entry in acct.get("workersInvocationsAdaptive", []):
    name = entry["dimensions"]["scriptName"]
    status = entry["dimensions"]["status"]
    if name not in workers:
        workers[name] = {"requests": 0, "errors": 0, "subrequests": 0, "cpu_p50_us": 0, "cpu_p99_us": 0}
    workers[name]["requests"] += entry["sum"]["requests"]
    workers[name]["subrequests"] += entry["sum"]["subrequests"]
    workers[name]["errors"] += entry["sum"]["errors"]
    if entry["quantiles"]["cpuTimeP50"] > workers[name]["cpu_p50_us"]:
        workers[name]["cpu_p50_us"] = entry["quantiles"]["cpuTimeP50"]
    if entry["quantiles"]["cpuTimeP99"] > workers[name]["cpu_p99_us"]:
        workers[name]["cpu_p99_us"] = entry["quantiles"]["cpuTimeP99"]

# Add workers with 0 activity
for wn in worker_names:
    if wn not in workers:
        workers[wn] = {"requests": 0, "errors": 0, "subrequests": 0, "cpu_p50_us": 0, "cpu_p99_us": 0}

total_worker_reqs = sum(w["requests"] for w in workers.values())
total_worker_errors = sum(w["errors"] for w in workers.values())

# Estimate total CPU ms (p50 * requests as rough estimate)
total_cpu_ms = sum(w["cpu_p50_us"] * w["requests"] / 1000 for w in workers.values())

# ── Aggregate D1 metrics ──
d1_dbs = {}
total_d1_reads = 0
total_d1_writes = 0
total_d1_rows_read = 0
total_d1_rows_written = 0
for entry in acct.get("d1AnalyticsAdaptiveGroups", []):
    db_id = entry["dimensions"]["databaseId"]
    name = d1_names.get(db_id, db_id[:8] + "...")
    d1_dbs[name] = {
        "id": db_id,
        "read_queries": entry["sum"]["readQueries"],
        "write_queries": entry["sum"]["writeQueries"],
        "rows_read": entry["sum"]["rowsRead"],
        "rows_written": entry["sum"]["rowsWritten"],
        "response_bytes": entry["sum"]["queryBatchResponseBytes"],
    }
    total_d1_reads += entry["sum"]["rowsRead"]
    total_d1_writes += entry["sum"]["rowsWritten"]
    total_d1_rows_read += entry["sum"]["rowsRead"]
    total_d1_rows_written += entry["sum"]["rowsWritten"]

# D1 storage from API list
total_d1_storage_bytes = sum(db.get("file_size", 0) for db in d1_list.get("result", []))
for db in d1_list.get("result", []):
    name = db["name"]
    if name not in d1_dbs:
        d1_dbs[name] = {"id": db["uuid"], "read_queries": 0, "write_queries": 0, "rows_read": 0, "rows_written": 0, "response_bytes": 0}
    d1_dbs[name]["storage_bytes"] = db.get("file_size", 0)

# ── Aggregate DO metrics ──
do_scripts = {}
for entry in acct.get("durableObjectsInvocationsAdaptiveGroups", []):
    name = entry["dimensions"]["scriptName"]
    do_scripts[name] = {"requests": entry["sum"]["requests"]}

total_do_reqs = sum(d["requests"] for d in do_scripts.values())

# DO duration (activeTime is in microseconds)
total_do_active_us = sum(
    e["sum"]["activeTime"]
    for e in acct.get("durableObjectsPeriodicGroups", [])
)
total_do_active_s = total_do_active_us / 1_000_000
total_do_gb_s = total_do_active_s * 128 / 1024  # 128MB per DO instance

# DO SQL storage
total_do_storage_bytes = sum(
    e["max"]["storedBytes"]
    for e in acct.get("durableObjectsSqlStorageGroups", [])
)

# ── KV ──
kv_ops = sum(e["sum"]["requests"] for e in acct.get("kvOperationsAdaptiveGroups", []))
kv_storage = max((e["max"]["byteCount"] for e in acct.get("kvStorageAdaptiveGroups", [])), default=0)
kv_keys = max((e["max"]["keyCount"] for e in acct.get("kvStorageAdaptiveGroups", [])), default=0)

# ── R2 ──
r2_ops = sum(e["sum"]["requests"] for e in acct.get("r2OperationsAdaptiveGroups", []))
r2_storage = max((e["max"]["payloadSize"] for e in acct.get("r2StorageAdaptiveGroups", [])), default=0)
r2_objects = max((e["max"]["objectCount"] for e in acct.get("r2StorageAdaptiveGroups", [])), default=0)

# ── Cost calculations ──
def calc_overage(used, included, rate):
    excess = max(0, used - included)
    return excess * rate

# Workers costs (paid plan)
worker_req_cost = calc_overage(total_worker_reqs, WORKER_REQ_INCLUDED, WORKER_REQ_OVERAGE)
worker_cpu_cost = calc_overage(total_cpu_ms, WORKER_CPU_INCLUDED / 1000, WORKER_CPU_OVERAGE)

# D1 costs
d1_read_cost = calc_overage(total_d1_rows_read, D1_ROWS_READ_INCLUDED, D1_ROWS_READ_OVERAGE)
d1_write_cost = calc_overage(total_d1_rows_written, D1_ROWS_WRITTEN_INCLUDED, D1_ROWS_WRITTEN_OVERAGE)
d1_storage_gb = total_d1_storage_bytes / (1024 ** 3)
d1_storage_cost = calc_overage(d1_storage_gb, D1_STORAGE_INCLUDED_GB, D1_STORAGE_OVERAGE)

# DO costs
do_req_cost = calc_overage(total_do_reqs, DO_REQ_INCLUDED, DO_REQ_OVERAGE)
do_duration_cost = calc_overage(total_do_gb_s, DO_DURATION_INCLUDED, DO_DURATION_OVERAGE)
do_storage_gb = total_do_storage_bytes / (1024 ** 3)
do_storage_cost = calc_overage(do_storage_gb, DO_SQL_STORAGE_INCLUDED_GB, DO_SQL_STORAGE_OVERAGE)

total_overage = (worker_req_cost + worker_cpu_cost +
                 d1_read_cost + d1_write_cost + d1_storage_cost +
                 do_req_cost + do_duration_cost + do_storage_cost)

# Determine plan recommendation
days_in_month = 30
daily_worker_reqs = total_worker_reqs / max(1, 10)  # ~10 days of data so far
daily_d1_reads = total_d1_rows_read / max(1, 10)
daily_d1_writes = total_d1_rows_written / max(1, 10)
daily_do_reqs = total_do_reqs / max(1, 10)

needs_paid = (
    daily_worker_reqs > FREE_WORKER_REQS_DAY or
    daily_d1_reads > FREE_D1_READS_DAY or
    daily_d1_writes > FREE_D1_WRITES_DAY or
    d1_storage_gb > FREE_D1_STORAGE_GB or
    daily_do_reqs > FREE_DO_REQS_DAY
)

# Free plan cost
free_plan_cost = 0.00 if not needs_paid else "N/A (exceeds limits)"
paid_plan_cost = PAID_BASE + total_overage

def fmt_num(n):
    if n >= 1_000_000_000:
        return f"{n/1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    elif n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(int(n))

def fmt_bytes(b):
    if b >= 1024**3:
        return f"{b/1024**3:.2f} GB"
    elif b >= 1024**2:
        return f"{b/1024**2:.1f} MB"
    elif b >= 1024:
        return f"{b/1024:.1f} KB"
    return f"{int(b)} B"

def fmt_money(n):
    return f"${n:.2f}"

def pct_of(used, limit):
    if limit == 0:
        return "—"
    p = (used / limit) * 100
    if p < 0.01 and used > 0:
        return "<0.01%"
    elif p > 100:
        return f"⚠️  {p:.0f}%"
    return f"{p:.1f}%"

# ── JSON output ──
if json_output:
    result = {
        "month": month,
        "account_id": os.environ.get("ACCOUNT_ID"),
        "workers": {name: data for name, data in workers.items()},
        "d1_databases": {name: data for name, data in d1_dbs.items()},
        "durable_objects": do_scripts,
        "kv": {"operations": kv_ops, "storage_bytes": kv_storage, "keys": kv_keys},
        "r2": {"operations": r2_ops, "storage_bytes": r2_storage, "objects": r2_objects},
        "totals": {
            "worker_requests": total_worker_reqs,
            "worker_errors": total_worker_errors,
            "worker_cpu_ms": total_cpu_ms,
            "d1_rows_read": total_d1_rows_read,
            "d1_rows_written": total_d1_rows_written,
            "d1_storage_bytes": total_d1_storage_bytes,
            "do_requests": total_do_reqs,
            "do_gb_seconds": total_do_gb_s,
            "do_storage_bytes": total_do_storage_bytes,
        },
        "cost_estimate": {
            "plan_recommendation": "paid" if needs_paid else "free",
            "free_plan_eligible": not needs_paid,
            "paid_plan_base": PAID_BASE,
            "overage": {
                "worker_requests": worker_req_cost,
                "worker_cpu": worker_cpu_cost,
                "d1_reads": d1_read_cost,
                "d1_writes": d1_write_cost,
                "d1_storage": d1_storage_cost,
                "do_requests": do_req_cost,
                "do_duration": do_duration_cost,
                "do_storage": do_storage_cost,
            },
            "total_overage": total_overage,
            "estimated_monthly_cost": 0.00 if not needs_paid else paid_plan_cost,
        }
    }
    print(json.dumps(result, indent=2))
    sys.exit(0)

# ── Pretty output ──
W = 72
print()
print("═" * W)
print("  ☁️  CLOUDFLARE ACCOUNT COST REPORT")
print(f"  Billing period: {month}")
print(f"  Generated: {os.popen('date -u +%Y-%m-%dT%H:%M:%SZ').read().strip()}")
print("═" * W)

# ── Workers ──
print(f"\n{'─'*W}")
print("  ⚡ WORKERS")
print(f"{'─'*W}")
print(f"  {'Worker':<35} {'Requests':>10} {'Errors':>8} {'CPU p50':>8} {'CPU p99':>8}")
print(f"  {'─'*35} {'─'*10} {'─'*8} {'─'*8} {'─'*8}")
for name, data in sorted(workers.items(), key=lambda x: -x[1]["requests"]):
    cpu50 = f"{data['cpu_p50_us']/1000:.1f}ms" if data['cpu_p50_us'] else "—"
    cpu99 = f"{data['cpu_p99_us']/1000:.1f}ms" if data['cpu_p99_us'] else "—"
    err_str = str(data['errors']) if data['errors'] else "—"
    print(f"  {name:<35} {fmt_num(data['requests']):>10} {err_str:>8} {cpu50:>8} {cpu99:>8}")

print(f"\n  Total requests:  {fmt_num(total_worker_reqs):>12}  │  Free limit: 100K/day = ~3M/mo")
print(f"  Total errors:    {fmt_num(total_worker_errors):>12}  │  Error rate: {total_worker_errors/max(1,total_worker_reqs)*100:.1f}%")
print(f"  Est. CPU time:   {fmt_num(total_cpu_ms):>10}ms  │  Free limit: 10ms/invocation")

if total_worker_errors > 0:
    # Check for exceededResources
    exceeded = sum(
        e["sum"]["errors"]
        for e in acct.get("workersInvocationsAdaptive", [])
        if e["dimensions"]["status"] == "exceededResources"
    )
    if exceeded:
        print(f"\n  ⚠️  {exceeded} requests hit CPU time limit (exceededResources)")
        print(f"     These are failing on the Free plan's 10ms CPU limit.")
        print(f"     Paid plan allows 30ms+ CPU time per request.")

# ── D1 Databases ──
print(f"\n{'─'*W}")
print("  🗄️  D1 DATABASES")
print(f"{'─'*W}")
print(f"  {'Database':<22} {'Reads':>9} {'Writes':>9} {'Rows Read':>11} {'Rows Written':>13} {'Storage':>10}")
print(f"  {'─'*22} {'─'*9} {'─'*9} {'─'*11} {'─'*13} {'─'*10}")
for name, data in sorted(d1_dbs.items(), key=lambda x: -(x[1].get("rows_read", 0))):
    storage = fmt_bytes(data.get("storage_bytes", 0))
    print(f"  {name:<22} {fmt_num(data['read_queries']):>9} {fmt_num(data['write_queries']):>9} {fmt_num(data['rows_read']):>11} {fmt_num(data['rows_written']):>13} {storage:>10}")

print(f"\n  Total rows read:     {fmt_num(total_d1_rows_read):>12}  │  Free: 5M/day  Paid: 25B/mo included")
print(f"  Total rows written:  {fmt_num(total_d1_rows_written):>12}  │  Free: 100K/day  Paid: 50M/mo included")
print(f"  Total storage:       {fmt_bytes(total_d1_storage_bytes):>12}  │  Free: 5 GB  Paid: 5 GB included")

# ── Durable Objects ──
print(f"\n{'─'*W}")
print("  🔒 DURABLE OBJECTS")
print(f"{'─'*W}")
if do_scripts:
    print(f"  {'Worker':<35} {'Requests':>12}")
    print(f"  {'─'*35} {'─'*12}")
    for name, data in sorted(do_scripts.items(), key=lambda x: -x[1]["requests"]):
        print(f"  {name:<35} {fmt_num(data['requests']):>12}")
    print(f"\n  Total requests:    {fmt_num(total_do_reqs):>12}  │  Free: 100K/day  Paid: 1M/mo")
    print(f"  Active duration:   {total_do_active_s:>10.1f}s  │  = {total_do_gb_s:.1f} GB-s")
    print(f"  SQL storage:       {fmt_bytes(total_do_storage_bytes):>12}  │  Free: 5 GB  Paid: 5 GB included")
else:
    print("  No Durable Object activity this period.")

# ── KV / R2 ──
if kv_ops or kv_storage or r2_ops or r2_storage:
    print(f"\n{'─'*W}")
    print("  📦 KV / R2 / QUEUES")
    print(f"{'─'*W}")
    if kv_ops or kv_storage:
        print(f"  KV operations: {fmt_num(kv_ops):<12}  KV storage: {fmt_bytes(kv_storage):<12}  Keys: {fmt_num(kv_keys)}")
    if r2_ops or r2_storage:
        print(f"  R2 operations: {fmt_num(r2_ops):<12}  R2 storage: {fmt_bytes(r2_storage):<12}  Objects: {fmt_num(r2_objects)}")
else:
    print(f"\n  📦 KV / R2 / Queues: not in use")

# ── Cost Summary ──
print(f"\n{'═'*W}")
print("  💰 COST ESTIMATE")
print(f"{'═'*W}")

print(f"\n  ┌{'─'*42}┬{'─'*14}┬{'─'*12}┐")
print(f"  │ {'Resource':<40} │ {'Free Plan':>12} │ {'Paid Plan':>10} │")
print(f"  ├{'─'*42}┼{'─'*14}┼{'─'*12}┤")

# Workers
wrk_free = f"{pct_of(daily_worker_reqs, FREE_WORKER_REQS_DAY)}/day"
wrk_paid = fmt_money(worker_req_cost)
print(f"  │ {'Worker requests (' + fmt_num(total_worker_reqs) + ')':<40} │ {wrk_free:>12} │ {wrk_paid:>10} │")

cpu_paid = fmt_money(worker_cpu_cost)
print(f"  │ {'Worker CPU (' + fmt_num(total_cpu_ms) + 'ms)':<40} │ {'—':>12} │ {cpu_paid:>10} │")

# D1
d1r_free = f"{pct_of(daily_d1_reads, FREE_D1_READS_DAY)}/day"
d1r_paid = fmt_money(d1_read_cost)
print(f"  │ {'D1 rows read (' + fmt_num(total_d1_rows_read) + ')':<40} │ {d1r_free:>12} │ {d1r_paid:>10} │")

d1w_free = f"{pct_of(daily_d1_writes, FREE_D1_WRITES_DAY)}/day"
d1w_paid = fmt_money(d1_write_cost)
print(f"  │ {'D1 rows written (' + fmt_num(total_d1_rows_written) + ')':<40} │ {d1w_free:>12} │ {d1w_paid:>10} │")

d1s_free = pct_of(d1_storage_gb, FREE_D1_STORAGE_GB)
d1s_paid = fmt_money(d1_storage_cost)
print(f"  │ {'D1 storage (' + fmt_bytes(total_d1_storage_bytes) + ')':<40} │ {d1s_free:>12} │ {d1s_paid:>10} │")

# DO
dor_free = f"{pct_of(daily_do_reqs, FREE_DO_REQS_DAY)}/day"
dor_paid = fmt_money(do_req_cost)
print(f"  │ {'DO requests (' + fmt_num(total_do_reqs) + ')':<40} │ {dor_free:>12} │ {dor_paid:>10} │")

dod_free = f"{pct_of(total_do_gb_s/10, FREE_DO_DURATION_DAY)}/day"
dod_paid = fmt_money(do_duration_cost)
print(f"  │ {'DO duration (' + f'{total_do_gb_s:.0f}' + ' GB-s)':<40} │ {dod_free:>12} │ {dod_paid:>10} │")

dos_paid = fmt_money(do_storage_cost)
print(f"  │ {'DO storage (' + fmt_bytes(total_do_storage_bytes) + ')':<40} │ {'—':>12} │ {dos_paid:>10} │")

print(f"  ├{'─'*42}┼{'─'*14}┼{'─'*12}┤")
print(f"  │ {'Base subscription':<40} │ {'$0.00':>12} │ {'$5.00':>10} │")
print(f"  │ {'Overage charges':<40} │ {'$0.00':>12} │ {fmt_money(total_overage):>10} │")
print(f"  ├{'─'*42}┼{'─'*14}┼{'─'*12}┤")

free_total = "$0.00" if not needs_paid else "N/A ⚠️"
print(f"  │ {'ESTIMATED TOTAL':<40} │ {free_total:>12} │ {fmt_money(paid_plan_cost):>10} │")
print(f"  └{'─'*42}┴{'─'*14}┴{'─'*12}┘")

# ── Recommendation ──
print(f"\n{'─'*W}")
print("  📋 RECOMMENDATION")
print(f"{'─'*W}")
if not needs_paid:
    print(f"\n  ✅ Stay on the FREE plan — ${0:.2f}/month")
    print(f"     All usage is well within free tier daily limits.")
    if total_worker_errors > 0:
        exceeded = sum(
            e["sum"]["errors"]
            for e in acct.get("workersInvocationsAdaptive", [])
            if e["dimensions"]["status"] == "exceededResources"
        )
        if exceeded:
            print(f"\n  ⚠️  HOWEVER: {exceeded} requests hit the 10ms CPU limit.")
            print(f"     Consider upgrading to Paid ($5/mo) for 30ms+ CPU time")
            print(f"     if this impacts user experience.")
else:
    print(f"\n  💳 Upgrade to the PAID plan — {fmt_money(paid_plan_cost)}/month")
    print(f"     You're exceeding free tier daily limits.")

# Monthly projection
proj_reqs = daily_worker_reqs * 30
proj_d1_reads = daily_d1_reads * 30
proj_d1_writes = daily_d1_writes * 30
proj_do_reqs = (total_do_reqs / max(1, 10)) * 30

print(f"\n  📈 30-Day Projection (based on avg daily usage):")
print(f"     Worker requests:  {fmt_num(proj_reqs)}/mo")
print(f"     D1 rows read:     {fmt_num(proj_d1_reads)}/mo")
print(f"     D1 rows written:  {fmt_num(proj_d1_writes)}/mo")
print(f"     DO requests:      {fmt_num(proj_do_reqs)}/mo")

print(f"\n{'═'*W}")
print()
PYEOF