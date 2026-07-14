# ADR 0004: HubSpot deal currency and contact-association scope

## Status

Accepted (documented limitation)

## Context

HubSpot deals have an `amount` property with no currency code attached in the standard (non
multi-currency) API response; multi-currency portals expose a separate `deal_currency_code`
property instead. Deals can also be associated with one or more contacts, but fetching
associations requires either a separate per-record API call or the `associations` parameter on
`basicApi.getPage`/`getById` — which the CRM Search API (`searchApi.doSearch`, used for
incremental sync) does not support at all.

## Decision

- Deal amounts are normalized assuming **USD** by default. Wiring real multi-currency support
  (reading `deal_currency_code` when present) is scoped as a documented future improvement rather
  than implemented now, since it doesn't affect the assignment's core correctness requirements and
  a free HubSpot developer test account defaults to single-currency.
- `primaryContactSourceId` on `CanonicalDeal` is always `null`. Populating it only during full
  sync (where `associations` is available) but not incremental sync (where it isn't) would mean
  the field flaps between a real value and `null` depending on which sync path last touched the
  record — worse than consistently omitting it.

## Consequences

- Any portal using multi-currency deals will have incorrect currency codes (always tagged USD)
  until this is addressed.
- Deal-to-contact association data isn't available through this pipeline; a consumer needing it
  would need a dedicated associations sync path (a natural, isolated extension — associations
  would become their own canonical relationship table, not a field bolted onto `CanonicalDeal`).
