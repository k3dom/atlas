import { describe, it } from '@effect/vitest'
import { deepStrictEqual } from '@effect/vitest/utils'
import type * as Artifact from 'atlas/artifact'

import { history } from '#/details.tsx'

const chunk = (id: string): Artifact.Chunk<Artifact.MeasuredFile> => ({
  kind: 'chunk',
  id,
  name: id,
  summary: `The ${id} code.`,
  tier: 2,
  rationale: 'Some branching.',
  essential: 70,
  files: [{ path: `src/${id}.ts`, lines: 10 }],
})

const revisePages = {
  kind: 'revise',
  chunk: 'pages',
  reason: 'Pages got a form.',
} as const
const reviseOther = {
  kind: 'revise',
  chunk: 'other',
  reason: 'Other got faster.',
} as const
const rename = {
  kind: 'rename',
  from: 'pages',
  to: 'views',
  reason: 'Pages became views.',
} as const
const split = {
  kind: 'split',
  from: 'views',
  into: ['views', 'extra'],
  reason: 'The extras grew apart.',
} as const
const add = {
  kind: 'add',
  chunk: 'pages',
  reason: 'New pages for the docs.',
} as const

const artifact: Artifact.Artifact = {
  version: 1,
  commit: 'd'.repeat(40),
  roots: ['src'],
  chunks: [chunk('views'), chunk('extra'), chunk('other'), chunk('pages')],
  history: [
    { commit: 'a'.repeat(40), events: [revisePages, reviseOther] },
    { commit: 'b'.repeat(40), events: [rename] },
    { commit: 'c'.repeat(40), events: [split, add] },
  ],
}

describe('history', () => {
  it.each(['views', 'extra'])(
    'follows %s back through the split and rename it came from, newest first',
    (id) => {
      deepStrictEqual(history(artifact, id), [
        { commit: 'c'.repeat(40), event: split },
        { commit: 'b'.repeat(40), event: rename },
        { commit: 'a'.repeat(40), event: revisePages },
      ])
    }
  )

  it('leaves out the events of other chunks', () => {
    deepStrictEqual(history(artifact, 'other'), [
      { commit: 'a'.repeat(40), event: reviseOther },
    ])
  })

  it('starts at the event that added a chunk whose id an earlier chunk had', () => {
    deepStrictEqual(history(artifact, 'pages'), [
      { commit: 'c'.repeat(40), event: add },
    ])
  })
})
