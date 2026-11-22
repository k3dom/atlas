import { defineConfig } from 'oxlint'

/**
 * Tailwind CSS rules, merged with another preset rather than used on its own:
 *
 * ```ts
 * export default Oxlint.merge(react, tailwind, {
 *   settings: {
 *     tailwindcss: { entryPoint: 'src/styles/base.css' },
 *   },
 * })
 * ```
 *
 * The consuming config has to set `settings.tailwindcss.entryPoint` itself, since only
 * it knows where its Tailwind entry CSS lives. A relative path resolves against the
 * directory of that config.
 *
 * Class order, whitespace and duplicates are left to `@atlas/oxfmt/tailwind`.
 */
export default defineConfig({
  jsPlugins: ['oxlint-tailwindcss'],
  rules: {
    'tailwindcss/no-conflicting-classes': 'error',
    'tailwindcss/no-deprecated-classes': 'error',
    'tailwindcss/no-unknown-classes': 'error',
    'tailwindcss/enforce-canonical': 'warn',
    'tailwindcss/no-unnecessary-arbitrary-value': 'warn',
    'tailwindcss/consistent-variant-order': 'warn',
    'tailwindcss/enforce-consistent-important-position': 'warn',
  },
})
