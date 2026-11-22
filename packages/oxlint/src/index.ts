import type { OxlintConfig } from 'oxlint'

const join = <A>(
  first: ReadonlyArray<A> | null | undefined,
  second: ReadonlyArray<A> | null | undefined
) =>
  first == null && second == null
    ? undefined
    : [...(first ?? []), ...(second ?? [])]

/**
 * Combines configs in order. `plugins`, `jsPlugins`, `overrides` and
 * `ignorePatterns` are joined, `rules` are merged with later configs winning,
 * and any other field is taken from the last config that sets it.
 */
export const merge = (...configs: ReadonlyArray<OxlintConfig>) =>
  configs.reduce<OxlintConfig>(
    (merged, config) => ({
      ...merged,
      ...config,
      plugins: join(merged.plugins, config.plugins),
      jsPlugins: join(merged.jsPlugins, config.jsPlugins),
      overrides: join(merged.overrides, config.overrides),
      ignorePatterns: join(merged.ignorePatterns, config.ignorePatterns),
      rules: { ...merged.rules, ...config.rules },
    }),
    {}
  )
