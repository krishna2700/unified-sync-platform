# ADR 0005: Stripe incremental sync strategy (polling + webhooks, not polling alone)

## Status

Accepted

## Context

Stripe has no `syncToken`/cursor concept like Google Calendar. `PaymentIntent.created` is
immutable — it never changes after the object is created — so filtering `created >= watermark`
only ever discovers _newly created_ intents. A `PaymentIntent` created before the current
watermark that later transitions status (e.g. `pending` → `succeeded`, or `succeeded` →
`refunded`) would never be picked up by polling on `created` alone, because its `created`
timestamp still sits in the past.

## Decision

Incremental REST polling (`StripePaymentProvider.fetchIncremental`) establishes the baseline and
catches genuinely new PaymentIntents, using a watermark tracked through the opaque `pageToken`
(see the class's doc comment for the exact page-token encoding). **Status transitions on existing
intents are covered separately, by the Stripe webhook handler**
(`POST /webhooks/stripe` in `src/api/http/routes/webhooks.routes.ts`), which fires the moment a
`payment_intent.*` event occurs and re-normalizes + upserts that intent through the _same_
`normalize()` method the polling path uses.

This is why the assignment's webhook requirements ("support duplicate deliveries", "never lose
data") aren't an optional add-on for Stripe — they are load-bearing for correctness, not just a
nice-to-have real-time optimization.

## Consequences

- If the Stripe webhook is ever misconfigured or down for an extended period, a payment that
  transitioned status during the outage will not be corrected until either the webhook resumes and
  Stripe redelivers, or a manual full backfill is triggered. This is an accepted gap given the
  assignment's scope; a production system would add a periodic full reconciliation pass
  (e.g. nightly) as a safety net — noted in the Future Improvements section of the README.
- `CanonicalPayment.sourceUpdatedAt` is set to the _polling_ fetch time by the REST path, but to
  the webhook event's own timestamp when a webhook updates it — the webhook path is deliberately
  the more precise of the two, since it fires exactly when the status actually changed.
