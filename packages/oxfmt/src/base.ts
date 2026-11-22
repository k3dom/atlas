import { defineConfig } from 'oxfmt'

/**
 * Shared base oxfmt configuration.
 */
export default defineConfig({
  printWidth: 80,
  proseWrap: 'always',
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  sortImports: true,
  ignorePatterns: ['dist', 'build', 'coverage'],
})
