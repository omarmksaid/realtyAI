# Meta & Google Ads connections

Both integrations are push-based — no polling, no CSV exports. Meta notifies and we
fetch the lead back with a token; Google posts the whole lead directly.

## Meta Lead Ads

### One-time (your sandbox or the customer's Business Manager)
1. **Business Manager** with the Facebook Page that runs the ads. For a customer,
   have them grant your Business Manager **partner access** to the Page
   (Business Settings → Pages → Assign partner) — never take their login.
2. **Meta app** (developers.facebook.com → Create App → Business type). Note the
   **App Secret** → `META_APP_SECRET`.
3. **Webhook subscription**: App → Webhooks → Page object → subscribe to `leadgen`.
   Callback URL `https://<api-domain>/webhooks/meta`, verify token = your
   `META_VERIFY_TOKEN`. Meta sends a GET handshake; our endpoint answers it.
   Then subscribe the specific Page to the app (Page subscriptions API or the
   webhook UI's "Subscribe" per page).
4. **System user token** (Business Settings → Users → System users): create one,
   assign the Page to it, generate a token with `leads_retrieval` +
   `pages_manage_metadata`. This token does the lead fetch-back and form discovery.
5. **lead_sources row** for the company:
   ```sql
   insert into lead_sources (company_id, provider, label, config) values
   ('<company>', 'meta', 'Northgate FB Page',
    '{"page_id": "<page id>", "page_access_token": "<system user token>", "form_project_map": {}}');
   ```
   Forms then auto-appear on the Sources page for mapping — no manual form IDs.

### Testing without spend
developers.facebook.com/tools/lead-ads-testing — pick the page + form, create a test
lead; it fires the real webhook through the full pipeline. Delete test leads there too.

### Caveats
- Lead data is retrievable for **90 days** via the API (we fetch within seconds, so
  this only matters if webhooks were down — replay via the testing tool or Graph).
- Serving pages you don't administer **at scale** requires Meta **app review** for
  `leads_retrieval` advanced access (takes weeks — start it when customer #2 signs).
  Partner access + your app in dev/standard mode covers a pilot.
- Webhook deliveries retry on non-200 — our upsert dedupe makes retries harmless.

## Google Ads lead forms

No OAuth, no tokens — each lead form asset posts to a URL you give it.

1. Create the source (Sources page "Add form", or API):
   `POST /sources {"label": "Riv Brand Search"}` → returns the **webhook URL** and **key**.
2. In Google Ads: the campaign's **lead form asset** → "Other data integration
   options" → Webhook → paste URL and key.
3. Click **Send test data**. Google posts with `is_test: true`; we record it and the
   Sources page flips that form to "Verified" — no fake lead is created or messaged.
4. Map the form to a project on the Sources page (Google sends `form_id` with every lead).

### Caveats
- Field `column_id`s are `FULL_NAME`, `PHONE_NUMBER`, `EMAIL` plus per-question IDs
  for custom qualifying questions — everything lands in `leads.form_data` regardless.
- Google retries failed deliveries only briefly — keep the endpoint healthy; the
  Sources page "last lead" column doubles as a liveness check.
- For managing a customer's ads properly, use a **manager account (MCC)** and have
  them link — but note the webhook works even without any account linkage, since
  it's configured inside the form asset itself.

## Which one first?
Google: ~10 minutes to live. Meta: an afternoon once, then nothing. Do Google first
for the demo-day dopamine, Meta in parallel since its review steps have wait time.
