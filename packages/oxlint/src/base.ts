import { defineConfig } from 'oxlint'

export default defineConfig({
  ignorePatterns: ['dist'],
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: 'deny',
    typeAware: true,
    typeCheck: true,
  },
  // Replaces oxlint's default plugin set rather than adding to it, so the
  // defaults (unicorn, typescript, oxc) have to be repeated here.
  plugins: ['unicorn', 'typescript', 'oxc', 'import', 'vitest'],
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
  },
  rules: {
    'eslint/array-callback-return': 'error',
    'eslint/curly': ['error', 'all'],
    'eslint/eqeqeq': ['error', 'always', { null: 'ignore' }],
    'eslint/no-case-declarations': 'error',
    'eslint/no-console': 'error',
    'eslint/no-promise-executor-return': 'error',
    'eslint/no-template-curly-in-string': 'error',
    'eslint/prefer-const': 'error',
    'import/no-cycle': 'error',
    'oxc/no-barrel-file': 'error',
    'typescript/ban-ts-comment': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/switch-exhaustiveness-check': 'error',
    'unicorn/no-abusive-eslint-disable': 'error',
    'unicorn/prefer-node-protocol': 'error',

    // `@effect/vitest` hands a `layer` block its own `it`, so every test in
    // one shadows the imported name.
    'eslint/no-shadow': ['error', { allow: ['it'] }],
    'eslint/no-underscore-dangle': ['error', { allow: ['_tag'] }],
    // Effect's `Model.Class` variants are plain structs, spread on purpose.
    'typescript/no-misused-spread': 'off',
    'unicorn/no-array-sort': 'off',
    'vitest/no-standalone-expect': [
      'error',
      {
        additionalTestBlockFunctions: [
          'it.effect',
          'it.effect.each',
          'it.live',
        ],
      },
    ],
  },
  overrides: [
    {
      // A package's entrypoint re-exports its public surface by design.
      files: ['src/index.ts'],
      rules: {
        'oxc/no-barrel-file': 'off',
      },
    },
    {
      files: ['**/test/**', '**/*.test.*'],
      rules: {
        // Fixtures stand in for large generated types (`as never`).
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
  ],
})
