/**
 * Architecture rules for the Clean/Hexagonal layering. Run via `npm run arch:check`
 * and also asserted from tests/architecture/*.test.ts so a broken rule fails `npm test` too.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-outward-deps',
      comment:
        'Domain is the innermost layer: it may not depend on application, infrastructure, integrations, api, or workers.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/(application|infrastructure|integrations|api|workers)' },
    },
    {
      name: 'application-no-integration-deps',
      comment:
        'Application layer orchestrates through domain ports only; it must never import a concrete integration adapter.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/integrations' },
    },
    {
      name: 'application-no-infrastructure-deps',
      comment:
        'Application layer must not depend on infrastructure (Prisma, queue, logging) directly; it depends on repository/port interfaces from domain.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/infrastructure' },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies anywhere in src.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'integrations-no-api-deps',
      comment:
        'Integration adapters are leaf nodes; they must not depend on the http api layer or workers.',
      severity: 'error',
      from: { path: '^src/integrations' },
      to: { path: '^src/(api|workers)' },
    },
    {
      name: 'only-revenue-calculator-touches-revenue-repository',
      comment:
        'RevenueRepository is a pure data-access port with no business rules of its own. If anything ' +
        'other than RevenueCalculator (or its Prisma implementation, which must import the port to ' +
        'implement it) can query payment aggregates directly, revenue logic can silently get duplicated ' +
        'and drift. This is the structural half of that guarantee; see also ' +
        'tests/architecture/revenue-single-source-of-truth.test.ts for the grep-based half.',
      severity: 'error',
      from: {
        // Barrel re-exports don't call the repository's query methods, so they're exempt;
        // anything that could actually *invoke* aggregate()/findUnknownStatuses() is restricted
        // to the calculator and its Prisma implementation.
        pathNot:
          '^(src/domain/ports/index\\.ts|src/application/revenue/revenue-calculator\\.ts|src/infrastructure/repositories/.*revenue.*)$',
      },
      to: { path: '^src/domain/ports/revenue-repository\\.port\\.ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
