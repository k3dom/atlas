import { describe, it } from '@effect/vitest'
import { assertFailure, assertSuccess } from '@effect/vitest/utils'
import type * as Artifact from 'atlas/artifact'

import { decode } from '#/app.tsx'

const routes = {
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
} as const

const group = {
  kind: 'group',
  id: 'app',
  name: 'App',
  summary: 'The app.',
  children: [routes],
} as const

const map: typeof Artifact.Artifact.Encoded = {
  version: 1,
  commit: 'cfd0bfad3fc6d20cf2231347d717e0d02acbc79c',
  roots: ['packages/app'],
  chunks: [group],
}

describe('decode', () => {
  it('reads the map that check writes', () => {
    const updated = {
      ...map,
      history: [
        {
          commit: '140f5a4d5a1c0e4f7b0e6b1f1f9d4c1b2a3e4f50',
          events: [
            { kind: 'revise', chunk: 'routes', reason: 'Routes got a page.' },
          ],
        },
      ],
    } as const
    assertSuccess(decode(JSON.stringify(updated, null, 2)), updated)
  })

  it('reads a map without history as one with no updates', () => {
    assertSuccess(decode(JSON.stringify(map)), { ...map, history: [] })
  })

  it('names every field of a map that breaks the schema', () => {
    assertFailure(
      decode(
        JSON.stringify({
          ...map,
          commit: 'main',
          chunks: [
            { ...group, children: [{ ...routes, tier: 5, essential: 120 }] },
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
