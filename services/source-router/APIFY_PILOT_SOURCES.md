# LJ Radar Imob — Apify pilot sources

These are the initial source profiles for the controlled pilot. They are not enabled until the corresponding Apify token and account Task IDs are configured in Render.

## 1. OLX — first Apify pilot

Preferred Store Actor: `solidcode/olx-brazil-scraper`

Why selected for the pilot:
- purpose-built for OLX Brazil;
- supports real-estate URLs and state filters;
- supports newest-first ordering;
- can enrich listing description, seller name and CEP;
- output includes listing ID, price, city, neighborhood and posting timestamp;
- the LJ adapter performs an exact requested-city check before accepting an OLX row.

The LJ Router builds an explicit city/transaction URL for ABCD targets. Initial live validation must use São Caetano do Sul only.

## 2. Instagram

Preferred Store Actor: `apify/instagram-scraper` (maintained by Apify).

Use as a secondary discovery source only. Configure a curated Task around public hashtags/places relevant to LJ operation. Do not treat generic real-estate posts as owner leads automatically; Router/downstream quality rules remain mandatory.

## 3. Facebook Marketplace

Preferred first evaluation: `apify/facebook-marketplace-scraper` (maintained by Apify).

It accepts Marketplace search/category/location URLs. A São Caetano-specific Task must be validated in Apify Console before its Task ID is added to Render.

## 4. Telegram

Preferred first evaluation: `automation-lab/telegram-scraper` for public channels only.

The Task should contain a curated allowlist of public real-estate channels. Private groups/channels and authenticated-session scraping are not part of the LJ pilot.

## Activation gate

No source is considered operational merely because an Actor or Task exists. For each source:
1. create and test the Task in the LJ Apify account;
2. configure only the Task ID in Render;
3. run a manual São Caetano pilot with a small item cap;
4. review false positives, dates, location and source URLs;
5. confirm cost/run;
6. only then allow automatic scheduling.

The Source Router remains the integration boundary. Apify never writes directly to Supabase.
