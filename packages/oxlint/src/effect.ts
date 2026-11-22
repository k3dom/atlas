import { recommended } from '@effect/tsgo/oxlint-presets'
import { defineConfig, type AllowWarnDeny } from 'oxlint'

export default defineConfig({
  plugins: ['effecttsgo'],
  rules: {
    // The preset is typed as oxlint's whole rule map, whose option types tsdown
    // can't name when it emits declarations for a config that spreads them.
    ...(recommended.rules as Record<`effecttsgo/${string}`, AllowWarnDeny>),

    'effecttsgo/crypto-random-uuid-in-effect': 'error',
    'effecttsgo/extends-native-error': 'error',
    'effecttsgo/global-console-in-effect': 'error',
    'effecttsgo/global-date-in-effect': 'error',
    'effecttsgo/global-fetch-in-effect': 'error',
    'effecttsgo/global-random-in-effect': 'error',
    'effecttsgo/global-timers-in-effect': 'error',
    'effecttsgo/instance-of-schema': 'error',
    'effecttsgo/process-env-in-effect': 'error',
    'effecttsgo/service-not-as-class': 'error',

    // Effect ships these off, but `base` turns on their categories.
    'effecttsgo/any-unknown-in-error-context': 'off',
    'effecttsgo/effect-try-without-catch': 'off',
    'effecttsgo/strict-effect-provide': 'off',

    // These flag code outside Effect too, where React and Node expect plain
    // JavaScript.
    'effecttsgo/async-function': 'off',
    'effecttsgo/crypto-random-uuid': 'off',
    'effecttsgo/global-console': 'off',
    'effecttsgo/global-date': 'off',
    'effecttsgo/global-fetch': 'off',
    'effecttsgo/global-random': 'off',
    'effecttsgo/global-timers': 'off',
    'effecttsgo/new-promise': 'off',
    'effecttsgo/node-builtin-import': 'off',
    'effecttsgo/prefer-schema-over-json': 'off',
    'effecttsgo/process-env': 'off',
    'effecttsgo/schema-sync': 'off',

    // `decodeUnknown*` marks input that arrives untyped, even where its static
    // type fits the schema.
    'effecttsgo/prefer-typed-schema-decoder': 'off',
    // No decoded input here carries `NaN` or `Infinity`.
    'effecttsgo/schema-number': 'off',
    // Effect's own code brands none of its schema classes and errors, and a
    // tagged one is already kept apart from other types by its literal `_tag`.
    'effecttsgo/schema-class-missing-brand': 'off',
    // Effect's HTTP, SQL, CLI and AI modules are all unstable, and some, such
    // as `effect/encoding/Zip`, experimental, and the exact version pin guards
    // against their breaking changes.
    'effecttsgo/unstable-api-usage': 'off',
    'effecttsgo/experimental-api-usage': 'off',

    // Reads the `return yield*` that `missing-return-yield-star` asks for as
    // returning a value.
    'typescript/consistent-return': 'off',
  },
  overrides: [
    {
      files: ['**/test/**', '**/*.test.*'],
      rules: {
        // Tests mint throwaway ids, decode fixtures synchronously, provide a
        // layer per case and fail with plain errors.
        'effecttsgo/crypto-random-uuid-in-effect': 'off',
        'effecttsgo/global-error-in-effect-failure': 'off',
        'effecttsgo/multiple-effect-provide': 'off',
        'effecttsgo/schema-sync-in-effect': 'off',
        'eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'vitest',
                // Vitest hoists `vi.mock` only when `vi` comes from `vitest`.
                allowImportNames: ['vi'],
                message:
                  'Import from @effect/vitest, which re-exports vitest and adds it.effect, layer and the assertion helpers.',
              },
            ],
          },
        ],
        // Count the `@effect/vitest/utils` helpers as assertions alongside
        // Vitest's own.
        'vitest/expect-expect': [
          'error',
          {
            assertFunctionNames: [
              'expect',
              'expectTypeOf',
              'assert',
              'assertType',
              'assert*',
              'deepStrictEqual',
              'notDeepStrictEqual',
              'strictEqual',
              'throws',
              'throwsAsync',
              'doesNotThrow',
            ],
          },
        ],
      },
    },
  ],
})
