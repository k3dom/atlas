import * as Oxlint from '@atlas/oxlint'
import effect from '@atlas/oxlint/effect'
import react from '@atlas/oxlint/react'
import tailwind from '@atlas/oxlint/tailwind'

export default Oxlint.merge(react, effect, tailwind, {
  settings: {
    tailwindcss: { entryPoint: 'src/styles.css' },
  },
})
