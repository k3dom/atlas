import { defineConfig } from 'vitest/config'

/** @import { UserConfig } from 'vitest/config' */

/** @type {UserConfig} */
const config = defineConfig({
  test: {
    // Tests against containers slow down a lot on a busy machine
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // More workers than half the cores took a third more CPU and a quarter
    // more memory without finishing any sooner
    maxWorkers: '50%',
    // A fresh worker per test file took two to five times the CPU, mostly
    // spent importing the same modules again
    isolate: false,
    coverage: {
      include: ['src/**/*.ts'],
    },
  },
})

export default config
