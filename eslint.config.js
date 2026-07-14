// @ts-check
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
      },
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Neither the core nor the typescript-eslint version of no-redeclare understands the
      // `const X = {...} as const; type X = ...` value+type merge (a type alias isn't
      // "declaration merging" to ESLint, even though tsc accepts it and it's a common,
      // deliberate idiom here for string-enum-like value objects). Disabled to avoid false positives.
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: 'error',
      // Per typescript-eslint's own guidance: no-undef produces false positives on ambient
      // global types (NodeJS.ProcessEnv, JSX, etc.) that only exist in the type system: tsc's
      // own checker already catches real undefined-reference bugs more reliably than this rule.
      'no-undef': 'off',
    },
  },
  {
    // CLI entry points (seed/migration scripts) legitimately print to stdout.
    files: ['scripts/**/*.ts', 'prisma/seed.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Domain and application layers are the hexagon core: they may only depend on
    // each other and on the shared kernel. Wiring concrete adapters happens exclusively
    // in the composition root (src/api, src/workers). Enforced structurally here as a
    // fast local signal; tests/architecture/*.test.ts (dependency-cruiser) is the source of truth.
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/integrations/**', '**/infrastructure/**', '**/api/**', '**/workers/**'],
              message:
                'Domain/application layers must not import infrastructure, integrations, api, or workers. Depend on domain ports instead.',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
];
