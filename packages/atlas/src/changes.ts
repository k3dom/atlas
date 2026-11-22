import { Array, Effect, type Option } from 'effect'

import * as Imports from '#/imports.ts'
import * as Repository from '#/repository.ts'
import * as Scope from '#/scope.ts'
import * as Store from '#/store.ts'

export type Change =
  | {
      readonly kind: 'added'
      readonly path: string
      readonly lines: number
    }
  | {
      readonly kind: 'changed'
      readonly path: string
      readonly chunk: string
      readonly stat: Option.Option<Repository.Stat>
    }
  | {
      readonly kind: 'renamed'
      readonly path: string
      readonly from: string
      readonly chunk: string
      readonly stat: Option.Option<Repository.Stat>
    }
  | {
      readonly kind: 'removed'
      readonly path: string
      readonly chunk: string
      readonly deleted: boolean
    }

export const run = Effect.fn('Changes.run')(function* () {
  const repository = yield* Repository.Repository
  const artifact = yield* Store.get()
  if (!(yield* repository.has(artifact.commit))) {
    return yield* new Store.MapError({
      reason: new Store.CommitMissing({ commit: artifact.commit }),
    })
  }
  const scope = yield* Scope.resolve(artifact.roots)
  const tracked = yield* repository.tracked()
  const diffs = new Map(
    Array.map(yield* repository.diff(artifact.commit), (diff) => [
      diff.path,
      diff,
    ])
  )
  const chunks = Imports.chunkOf(artifact.chunks)
  const inScope = new Set(Array.map(scope.files, (file) => file.path))

  const current = Array.flatMap(scope.files, (file): Array<Change> => {
    const diff = diffs.get(file.path)
    const chunk = chunks.get(file.path)
    if (chunk !== undefined) {
      return diff === undefined
        ? []
        : [{ kind: 'changed', path: file.path, chunk, stat: diff.stat }]
    }
    const from = diff?.from
    const previous =
      from === undefined || inScope.has(from) ? undefined : chunks.get(from)
    return diff === undefined || from === undefined || previous === undefined
      ? [{ kind: 'added', path: file.path, lines: file.lines }]
      : [
          {
            kind: 'renamed',
            path: file.path,
            from,
            chunk: previous,
            stat: diff.stat,
          },
        ]
  })
  const renamed = new Set(
    Array.flatMap(current, (change) =>
      change.kind === 'renamed' ? [change.from] : []
    )
  )
  const removed = Array.flatMap(
    Array.fromIterable(chunks),
    ([path, chunk]): Array<Change> =>
      inScope.has(path) || renamed.has(path)
        ? []
        : [{ kind: 'removed', path, chunk, deleted: !tracked.has(path) }]
  )
  return { artifact, changes: [...current, ...removed] }
})
