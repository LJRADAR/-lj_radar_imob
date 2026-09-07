# LJ Radar Imob — Apify Task Contract

The Source Router can call dedicated Apify Tasks for `olx`, `instagram`, `facebook`, and `telegram`.

## Security and cost rules

- Authentication uses `APIFY_TOKEN` only inside Render.
- The token must never be committed to GitHub or stored in frontend code.
- Every run is capped by `APIFY_MAX_CHARGE_USD` (default pilot cap: USD 0.25).
- Every run is time-limited by `APIFY_TIMEOUT_SECS` (default pilot: 35 seconds).
- Automatic LJ collection remains disabled until at least one source passes a real São Caetano pilot.
- A Task must only collect content the LJ operation is permitted to process. Source-specific platform rules still apply.

## Environment variables

- `APIFY_TOKEN`
- `APIFY_TASK_OLX`
- `APIFY_TASK_INSTAGRAM`
- `APIFY_TASK_FACEBOOK`
- `APIFY_TASK_TELEGRAM`
- `APIFY_MAX_CHARGE_USD`
- `APIFY_TIMEOUT_SECS`

## Input sent by the Source Router

The Router sends JSON containing:

```json
{
  "lj_request": {
    "state_code": "SP",
    "city": "São Caetano do Sul",
    "transaction_type": "sale",
    "property_type_code": null,
    "limit": 20
  },
  "maxItems": 20
}
```

Each Task should use `lj_request` to constrain collection. The Task may have additional defaults configured in Apify Console.

## Output expected by the Source Router

A Task should write one dataset item per public listing/post. The Router accepts these canonical fields and several common aliases:

```json
{
  "url": "https://source.example/item/123",
  "id": "123",
  "title": "Apartment for sale in São Caetano",
  "description": "Public listing text",
  "price": 650000,
  "currency": "BRL",
  "city": "São Caetano do Sul",
  "neighborhood": "Santa Paula",
  "publishedAt": "2026-09-07T00:00:00Z",
  "sellerName": "Public advertiser name",
  "phone": null,
  "whatsapp": null,
  "propertyType": "Apartamento"
}
```

The required minimum is a valid public `http/https` URL. Missing fields remain null; the Router must not invent them.

## Source order

1. Threads official API when credentials are available.
2. Apify Tasks for sources where a dedicated compliant Task has been selected and tested.
3. No generic external search fallback by default.

## Promotion rule

Apify output is a discovery input, not an automatic approval. It still passes through LJ normalization, deduplication, geographic checks, quality rules, and workspace isolation before becoming an opportunity.
