import { defineConfig } from 'oxfmt'

import base from './base.ts'

/**
 * Base config plus Tailwind CSS class sorting (replaces `prettier-plugin-tailwindcss`).
 *
 * Packages should point `sortTailwindcss.stylesheet`
 * at their Tailwind v4 entry CSS for theme-aware ordering, e.g.
 * `sortTailwindcss: { ...tailwind.sortTailwindcss, stylesheet: './src/styles/base.css' }`.
 */
export default defineConfig({
  ...base,
  sortTailwindcss: {
    functions: ['cn', 'tv', 'cva', 'clsx', 'twMerge', 'cx'],
  },
})
