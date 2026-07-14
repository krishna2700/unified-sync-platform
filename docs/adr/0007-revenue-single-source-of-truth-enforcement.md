# ADR 0007: Enforcing a single revenue calculation implementation

## Status

Accepted

## Context

The assignment requires that "if someone later writes another revenue calculation elsewhere,
automated tests or architecture rules immediately catch the inconsistency" — a specific,
falsifiable guarantee, not just good intentions in a code review.

## Decision

Two independent, automated mechanisms, both run as part of `npm test`:

1. **Structural (dependency-cruiser rule `only-revenue-calculator-touches-revenue-repository`,**
   `.dependency-cruiser.cjs`**).** Only `RevenueCalculator` and its Prisma implementation may
   import `RevenueRepository` — the port that can query payment aggregates at all. Anything else
   (a route handler, a future second "quick revenue widget" service) that tries to query payment
   amounts directly fails the dependency graph check.
2. **Textual (grep-based, `tests/architecture/revenue-single-source-of-truth.test.ts`).** A second,
   independent line of defense that can't be fooled by re-exports or dynamic imports: it scans
   every source file for direct references to `RevenueRepository`'s port module and to the
   `REVENUE_COLLECTED_STATUSES` allow-list constant, and scans route handlers for suspicious
   amount-arithmetic patterns (`.reduce(`, `+=` on `amountMinor`, raw `SUM(`). This test was
   verified during development to actually fail when a route handler imports `RevenueRepository`
   or references collected-status arithmetic directly (not just written to vacuously pass).

Both mechanisms were deliberately kept independent (one graph-based, one text-based) so that a
weakness in one approach (e.g. a dynamic `import()` dependency-cruiser might not trace) doesn't
leave the guarantee unenforced.

## Consequences

- Every future revenue-shaped feature (a CSV export, a dashboard widget, a second reporting
  endpoint) must go through `RevenueCalculator.calculate()`. This is the intended constraint, not
  a limitation — it is exactly what "one canonical business definition" requires.
- The grep patterns are necessarily a little conservative/opinionated (e.g. `.reduce(` anywhere in
  a route file trips the check even for unrelated array logic). This is an accepted, deliberate
  false-positive risk in exchange for zero false negatives on the one pattern that actually
  matters — inline revenue summation.
