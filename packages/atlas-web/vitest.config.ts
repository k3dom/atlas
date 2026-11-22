import sharedConfig from '@atlas/vitest'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['./test/**/*.test.ts'],
    },
  })
)
