# LJ Radar Imob — Apify pilot sources

These are the initial source profiles for the controlled pilot. They are not enabled until the corresponding Apify token and account Task IDs are configured in Render.

## Activation order

The order is mandatory for the pilot:
1. **OLX / São Caetano do Sul** — first real collection source.
2. **QuintoAndar verifier** — positive-match-only verification; empty results remain `inconclusive`.
3. **Instagram** — only after OLX quality is validated.
4. **Facebook Marketplace/public groups** — only after a source-specific Task is reviewed.
5. **Telegram public channels** — curated allowlist only.

Do **not** enable `source=all` until each source has passed its own manual pilot.

## 1. OLX — first Apify pilot

Preferred Store Actor: `solidcode/olx-brazil-scraper`

Why selected for the pilot:
- purpose-built for OLX Brazil;
- supports real-estate URLs and state filters;
- supports newest-first ordering;
- can enrich listing description, seller name and CEP;
- output includes listing ID, price, city, neighborhood and posting timestamp;
- the LJ adapter performs an exact requested-city check before accepting an OLX row.

The LJ Router builds an explicit city/transaction URL for ABCD targets. Initial live validation must use **São Caetano do Sul only**.

Current Router quality gates before a row can reach Supabase:
- returned URL must belong to the expected source domain;
- obvious professional/business advertisers are rejected;
- seller name/type/CRECI evidence is checked;
- tracking parameters are removed for dedupe;
- wrong-city OLX rows are rejected;
- `published_at` is preserved when the Actor provides it;
- cost and item caps remain enforced per run.

## 2. QuintoAndar — verifier only

Preferred Store Actor: `solidcode/quintoandar-scraper`.

This Task is **not a lead source**. It is used only by `/verify-quinto` to confirm a strong positive match.

Rules:
- strong match requires multiple independent property signals;
- empty dataset, timeout, weak match or Actor failure = `inconclusive`;
- absence of a result never means `not_on_quinto`;
- the same Apify per-run cost guard applies.

## 3. Instagram

Preferred Store Actor: `apify/instagram-scraper` (maintained by Apify).

Use as a secondary discovery source only. Configure a curated Task around public hashtags/places relevant to LJ operation. Do not treat generic real-estate posts as owner leads automatically; Router/downstream quality rules remain mandatory.

## 4. Facebook Marketplace/public groups

Preferred first evaluation: `apify/facebook-marketplace-scraper` (maintained by Apify) where compatible with the required public scope.

A São Caetano-specific Task must be validated in Apify Console before its Task ID is added to Render. Group-name text alone must never be treated as proof of property location.

## 5. Telegram

Preferred first evaluation: `automation-lab/telegram-scraper` for public channels only.

The Task should contain a curated allowlist of public real-estate channels. Private groups/channels and authenticated-session scraping are not part of the LJ pilot.

## Activation gate per source

No source is considered operational merely because an Actor or Task exists. For each source:
1. create/update the Task through `npm run apify:bootstrap` or the Apify Console;
2. configure only the returned Task ID in Render;
3. run a manual São Caetano pilot with a small item cap;
4. review false positives, seller type, dates, location and source URLs;
5. verify `source_report` counters: raw → quality rejected → qualified → persisted;
6. confirm actual cost/run;
7. only then allow that source into automatic scheduling.

The Source Router remains the integration boundary. **Apify never writes directly to Supabase.**
