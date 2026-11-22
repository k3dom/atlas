import { defineConfig } from 'oxlint'

import base from './base.ts'

export default defineConfig({
  ...base,
  plugins: [...base.plugins, 'react', 'jsx-a11y'],
  rules: {
    ...base.rules,
    'react/rules-of-hooks': 'error',
    // Stylesheets are imported for their side effect.
    'import/no-unassigned-import': 'off',
    'react/react-in-jsx-scope': 'off',
  },
})
