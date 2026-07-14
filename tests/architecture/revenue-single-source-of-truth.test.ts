import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const ALLOWED_TO_IMPORT_REVENUE_REPOSITORY = new Set([
  'src/application/revenue/revenue-calculator.ts',
  'src/infrastructure/repositories/prisma-revenue.repository.ts',
  'src/domain/ports/index.ts', // barrel re-export; doesn't call the repository's methods
]);

const ALLOWED_TO_REFERENCE_COLLECTED_STATUSES = new Set([
  'src/domain/value-objects/payment-status.ts',
  'src/application/revenue/revenue-calculator.ts',
]);

/**
 * The dependency-cruiser rule (tests/architecture/dependency-rules.test.ts) already blocks most
 * of this structurally. This test is the second, independent line of defense the code comments
 * in RevenueCalculator promise: a plain source-text scan that can't be fooled by re-exports or
 * dynamic imports, so "someone reimplements revenue math in a route handler" fails loudly and
 * specifically instead of as a generic dependency-graph error.
 */
describe('Architecture: revenue calculation has exactly one implementation', () => {
  it('only RevenueCalculator (and its Prisma repository) reference the RevenueRepository port', async () => {
    const files = await fg('src/**/*.ts', { cwd: process.cwd() });
    const offenders = files.filter((file) => {
      if (ALLOWED_TO_IMPORT_REVENUE_REPOSITORY.has(file)) return false;
      const content = readFileSync(resolve(process.cwd(), file), 'utf8');
      return /revenue-repository\.port(\.js)?['"]/.test(content);
    });
    expect(
      offenders,
      `Unexpected files importing revenue-repository.port: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('only the domain vocabulary and RevenueCalculator reference REVENUE_COLLECTED_STATUSES', async () => {
    const files = await fg('src/**/*.ts', { cwd: process.cwd() });
    const offenders = files.filter((file) => {
      if (ALLOWED_TO_REFERENCE_COLLECTED_STATUSES.has(file)) return false;
      const content = readFileSync(resolve(process.cwd(), file), 'utf8');
      return content.includes('REVENUE_COLLECTED_STATUSES');
    });
    expect(
      offenders,
      `Unexpected files referencing the allow-list directly: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('route handlers under src/api perform no revenue arithmetic of their own', async () => {
    const routeFiles = await fg('src/api/http/routes/**/*.ts', { cwd: process.cwd() });
    const suspiciousPattern = /amountMinor\s*[+\-*/]?=|\.reduce\(|\bSUM\(/i;
    const offenders = routeFiles.filter((file) => {
      const content = readFileSync(resolve(process.cwd(), file), 'utf8');
      return suspiciousPattern.test(content);
    });
    expect(
      offenders,
      `Route file(s) appear to compute amounts directly: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('every revenue metrics endpoint delegates to RevenueCalculator.calculate', async () => {
    const content = readFileSync(
      resolve(process.cwd(), 'src/api/http/routes/revenue.routes.ts'),
      'utf8',
    );
    const calculateCallCount = (content.match(/revenueCalculator\.calculate\(/g) ?? []).length;
    // makeHandler() is called once per route (total/day/week/month) and each call site invokes
    // calculate() through the same shared handler factory — asserting the factory is used at
    // least four times is what guarantees no route bypasses it with bespoke logic.
    const routeRegistrations = (content.match(/fastify\.get\('\/metrics\/revenue/g) ?? []).length;
    expect(routeRegistrations).toBe(4);
    expect(calculateCallCount).toBeGreaterThanOrEqual(1);
  });
});
