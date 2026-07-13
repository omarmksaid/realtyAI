#!/usr/bin/env bash
#
# Simulate a Google Ads lead-form webhook, exactly as Google sends it.
#
#   ./scripts/google-lead.sh          # a REAL lead → creates a lead, WhatsApp + AI call fire
#   ./scripts/google-lead.sh --test   # is_test:true → verifies the pipe, contacts NOBODY
#
# Why both modes matter: Google's own "Send test data" button sets is_test:true, and our
# webhook deliberately stops there (src/routes/webhooks/leads.ts) — it records that the pipe
# works and returns, without creating a lead. If it didn't, clicking Google's test button
# would fire a live WhatsApp and an AI phone call at +16505550123, a Google placeholder
# number. So a green "test received" does NOT prove leads actually route: only a real
# payload exercises project mapping, the routing rules, and the channels.
#
set -euo pipefail

# ── Your lead form ────────────────────────────────────────────────────────────
WEBHOOK="https://realtyai-production-4e46.up.railway.app/webhooks/google?src=eff21e5c-4283-4e6b-a0be-abc41b3ece7c"
GOOGLE_KEY="AWlbolclOLgysIIO6GA5IgnP"
FORM_ID=391309509365          # your real Google lead form
CAMPAIGN_ID=10000000000

# ── Who the "lead" is (you) ───────────────────────────────────────────────────
FULL_NAME="Omar Said"
EMAIL="omarmksaid@gmail.com"
PHONE="+16283587659"          # a REAL lead will ring this number

IS_TEST=false
[[ "${1:-}" == "--test" ]] && IS_TEST=true

# Unique per run: leads are deduped on (company, provider, external_id), so a repeated
# lead_id is silently swallowed as a duplicate and nothing happens.
LEAD_ID="sim-$(date +%s)-$RANDOM"

read -r -d '' PAYLOAD <<JSON || true
{
  "lead_id": "$LEAD_ID",
  "user_column_data": [
    { "column_name": "Full Name",   "string_value": "$FULL_NAME", "column_id": "FULL_NAME" },
    { "column_name": "User Email",  "string_value": "$EMAIL",     "column_id": "EMAIL" },
    { "column_name": "User Phone",  "string_value": "$PHONE",     "column_id": "PHONE_NUMBER" },
    { "column_name": "Country",     "string_value": "Canada",     "column_id": "COUNTRY" },
    { "column_name": "City",        "string_value": "Oakville",   "column_id": "CITY" },
    { "column_name": "Postal Code", "string_value": "L6J 1H4",    "column_id": "POSTAL_CODE" }
  ],
  "api_version": "1.0",
  "form_id": $FORM_ID,
  "campaign_id": $CAMPAIGN_ID,
  "google_key": "$GOOGLE_KEY",
  "is_test": $IS_TEST,
  "gcl_id": "$LEAD_ID",
  "adgroup_id": 20000000000,
  "creative_id": 30000000000
}
JSON

if [[ "$IS_TEST" == "true" ]]; then
  echo "→ TEST lead (is_test: true) — records that the pipe works, contacts nobody."
else
  echo "⚠️  REAL lead — this will message and CALL $PHONE. Ctrl-C now to abort."
  sleep 3
fi

echo "   lead_id: $LEAD_ID"
echo

RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

BODY=$(echo "$RESPONSE" | sed '$d')
CODE=$(echo "$RESPONSE" | tail -1)

echo "HTTP $CODE"
echo "$BODY"
echo

case "$CODE" in
  200)
    if [[ "$IS_TEST" == "true" ]]; then
      echo "✅ Pipe verified. The Sources page should now read \"Verified · test received\"."
      echo "   No lead was created and nobody was contacted — that's correct."
      echo "   Run without --test to actually exercise routing and the channels."
    else
      echo "✅ Lead accepted and routed. Check the Leads page; your phone should ring shortly"
      echo "   (WhatsApp first, then the AI call ~1 min later if you don't reply)."
    fi
    ;;
  403)
    echo "❌ Rejected. The google_key didn't match the one stored on this lead source,"
    echo "   or the ?src= id is wrong. Both are shown on the Sources page."
    ;;
  *)
    echo "❌ Unexpected response — see the body above."
    ;;
esac
