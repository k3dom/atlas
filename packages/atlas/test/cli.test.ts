import { NodeServices } from '@effect/platform-node'
import { assert, layer } from '@effect/vitest'
import { deepStrictEqual } from '@effect/vitest/utils'
import { Effect, FileSystem, Path, Schema } from 'effect'

import * as Artifact from '#/artifact.ts'
import { atlas, workspace } from '#test/fixture.ts'

const chunk = (id: string, ...paths: ReadonlyArray<string>) => ({
  kind: 'chunk' as const,
  id,
  name: id,
  summary: `The ${id} code.`,
  tier: 2 as const,
  rationale: 'Some branching.',
  essential: 70,
  files: paths.map((path) => ({ path })),
})

const draft = {
  roots: ['packages/app'],
  chunks: [
    {
      kind: 'group',
      id: 'app',
      name: 'App',
      summary: 'The app.',
      children: [
        chunk(
          'entry',
          'packages/app/src/index.ts',
          'packages/app/src/local.ts',
          'packages/app/src/lazy.ts'
        ),
        chunk('pages', 'packages/app/src/page.ts'),
      ],
    },
    chunk('helper', 'packages/lib/src/helper.ts', 'packages/lib/src/deep.ts'),
  ],
}

const writeDraft = Effect.fnUntraced(function* (root: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(root, 'draft.json')
  yield* fs.writeFileString(file, JSON.stringify(value))
  return file
})

layer(NodeServices.layer, { timeout: 60_000 })('atlas', (it) => {
  it.effect(
    'scopes the files of a root and the workspace files they import, with their line counts',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace
        const path = yield* Path.Path

        const { stdout, stderr, exitCode } = yield* atlas(
          path.join(root, 'packages/app/src'),
          'scope',
          '..'
        )

        assert.strictEqual(exitCode, 0)
        deepStrictEqual(stdout.split('\n'), [
          '6  packages/app/src/index.ts',
          '1  packages/app/src/lazy.ts',
          '1  packages/app/src/local.ts',
          '1  packages/app/src/page.ts',
          '3  packages/lib/src/deep.ts',
          '3  packages/lib/src/helper.ts',
          '',
        ])
        assert.include(
          stderr,
          '6 files with 15 lines in the scope of packages/app.'
        )
        assert.include(stderr, 'missing-package from packages/app/src/index.ts')
      })
  )

  it.effect(
    'writes the map with line counts and the commit it measured itself',
    () =>
      Effect.gen(function* () {
        const { root, commit } = yield* workspace
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const { exitCode } = yield* atlas(
          root,
          'check',
          yield* writeDraft(root, draft)
        )

        assert.strictEqual(exitCode, 0)
        const map = yield* fs
          .readFileString(path.join(root, '.atlas/map.json'))
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(Artifact.Artifact)
              )
            )
          )
        assert.strictEqual(map.commit, commit)
        deepStrictEqual(map.chunks[1], {
          ...chunk('helper'),
          files: [
            { path: 'packages/lib/src/helper.ts', lines: 3 },
            { path: 'packages/lib/src/deep.ts', lines: 3 },
          ],
        })
      })
  )

  it.effect('names the files a draft leaves in no chunk', () =>
    Effect.gen(function* () {
      const { root } = yield* workspace
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const { stderr, exitCode } = yield* atlas(
        root,
        'check',
        yield* writeDraft(root, {
          ...draft,
          chunks: [draft.chunks[0]],
        })
      )

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, 'has 2 problems')
      assert.include(
        stderr,
        'packages/lib/src/deep.ts (3 lines) is in no chunk.'
      )
      assert.include(
        stderr,
        'packages/lib/src/helper.ts (3 lines) is in no chunk.'
      )
      assert.isFalse(yield* fs.exists(path.join(root, '.atlas')))
    })
  )

  it.effect('names a file a draft puts in two chunks and both chunks', () =>
    Effect.gen(function* () {
      const { root } = yield* workspace

      const { stderr, exitCode } = yield* atlas(
        root,
        'check',
        yield* writeDraft(root, {
          ...draft,
          chunks: [...draft.chunks, chunk('extra', 'packages/app/src/page.ts')],
        })
      )

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, 'has a problem')
      assert.include(
        stderr,
        'packages/app/src/page.ts is in the chunks "pages" and "extra".'
      )
    })
  )

  it.effect(
    'names ids used twice and files that are missing or out of scope',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace

        const { stderr, exitCode } = yield* atlas(
          root,
          'check',
          yield* writeDraft(root, {
            ...draft,
            chunks: [
              ...draft.chunks,
              chunk(
                'helper',
                'packages/lib/src/unused.ts',
                'packages/lib/src/gone.ts'
              ),
            ],
          })
        )

        assert.strictEqual(exitCode, 1)
        assert.include(stderr, 'has 3 problems')
        assert.include(stderr, 'The id "helper" belongs to 2 nodes.')
        assert.include(
          stderr,
          'packages/lib/src/unused.ts is not in the scope of packages/app.'
        )
        assert.include(stderr, 'packages/lib/src/gone.ts does not exist.')
      })
  )

  it.effect('points to the fields of a draft that break the schema', () =>
    Effect.gen(function* () {
      const { root } = yield* workspace

      const { stderr, exitCode } = yield* atlas(
        root,
        'check',
        yield* writeDraft(root, {
          ...draft,
          chunks: [{ ...chunk('entry'), tier: 5, lines: 3 }],
        })
      )

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, 'chunks[0].tier: Expected 1 | 2 | 3 | 4')
      assert.include(stderr, 'chunks[0].lines: Expected no excess property')
      assert.include(stderr, 'chunks[0].files[0]: Missing key')
    })
  )
})
