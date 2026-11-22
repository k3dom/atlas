import base from '@atlas/oxfmt/base'
import { defineConfig } from 'oxfmt'

export default defineConfig({
  ...base,
  ignorePatterns: [...base.ignorePatterns, 'pnpm-lock.yaml', 'flake.lock'],
})
