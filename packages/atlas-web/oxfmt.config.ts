import tailwind from '@atlas/oxfmt/tailwind'
import { defineConfig } from 'oxfmt'

export default defineConfig({
  ...tailwind,
  sortTailwindcss: {
    ...tailwind.sortTailwindcss,
    stylesheet: './src/styles.css',
  },
})
