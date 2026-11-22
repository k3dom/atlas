import { describe, it } from '@effect/vitest'
import { assertFailure, assertSuccess } from '@effect/vitest/utils'

import { decode } from '#/app.tsx'

const map = {
  version: 1,
  commit: 'cfd0bfad3fc6d20cf2231347d717e0d02acbc79c',
  roots: ['packages/app'],
  chunks: [
    {
      kind: 'group',
      id: 'app',
      name: 'App',
      summary: 'The app.',
      children: [
        {
          kind: 'chunk',
          id: 'routes',
          name: 'Routes',
          summary: 'Wires the pages to their paths.',
          tier: 1,
          rationale: 'Declarations only.',
          essential: 80,
          files: [
            { path: 'packages/app/src/routes.ts', lines: 40 },
            { path: 'packages/app/src/index.ts', lines: 12, mixed: true },
          ],
        },
      ],
    },
  ],
}

describe('decode', () => {
  it('reads the map that check writes', () => {
    assertSuccess(decode(JSON.stringify(map, null, 2)), map as never)
  })

  it('names every field of a map that breaks the schema', () => {
    const [group] = map.chunks
    assertFailure(
      decode(
        JSON.stringify({
          ...map,
          commit: 'main',
          chunks: [
            {
              ...group,
              children: [{ ...group?.children[0], tier: 5, essential: 120 }],
            },
          ],
        })
      ),
      [
        'commit: Expected a string matching the RegExp ^[0-9a-f]{40}$',
        'chunks[0].children[0].tier: Expected 1 | 2 | 3 | 4',
        'chunks[0].children[0].essential: Expected a value between 0 and 100',
      ]
    )
  })

  it('reports a file that is not JSON', () => {
    assertFailure(decode('{"version": 1,'), ['Expected a valid JSON string'])
  })
})
