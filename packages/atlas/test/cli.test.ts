import { NodeServices } from '@effect/platform-node'
import { assert, layer } from '@effect/vitest'
import { deepStrictEqual } from '@effect/vitest/utils'
import { Array, Effect, FileSystem, Path, Schema, String } from 'effect'

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
  files: Array.map(paths, (path) => ({ path })),
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
    chunk(
      'helper',
      'packages/lib/src/helper.ts',
      'packages/lib/src/deep.ts',
      'packages/lib/src/ids.ts'
    ),
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
        deepStrictEqual(String.split(stdout, '\n'), [
          '7  packages/app/src/index.ts',
          '1  packages/app/src/lazy.ts',
          '1  packages/app/src/local.ts',
          '2  packages/app/src/page.ts',
          '3  packages/lib/src/deep.ts',
          '4  packages/lib/src/helper.ts',
          '2  packages/lib/src/ids.ts',
          '',
        ])
        assert.include(
          stderr,
          '7 files with 20 lines in the scope of packages/app.'
        )
        assert.include(stderr, 'packages/app/src/routes.gen.ts')
        assert.include(stderr, 'missing-package from packages/app/src/index.ts')
        assert.include(
          stderr,
          "imports point to files git doesn't track, such as build output or new files, so they are left out:\n  ../dist/built.js from packages/lib/src/helper.ts"
        )
      })
  )

  it.effect(
    'reports a tracked file deleted from the working tree as an unresolved import',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        yield* fs.remove(path.join(root, 'packages/app/src/lazy.ts'))

        const { stdout, stderr, exitCode } = yield* atlas(
          root,
          'scope',
          'packages/app'
        )

        assert.strictEqual(exitCode, 0)
        assert.notInclude(stdout, 'lazy.ts')
        assert.include(stderr, './lazy.ts from packages/app/src/index.ts')
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
          yield* writeDraft(root, { ...draft, roots: ['./packages/app/'] })
        )

        assert.strictEqual(exitCode, 0)
        const text = yield* fs.readFileString(
          path.join(root, '.atlas/map.json')
        )
        const map = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Artifact.Artifact)
        )(text)
        assert.strictEqual(map.commit, commit)
        deepStrictEqual(map.roots, ['packages/app'])
        deepStrictEqual(map.chunks[1], {
          ...chunk('helper'),
          files: [
            { path: 'packages/lib/src/helper.ts', lines: 4 },
            { path: 'packages/lib/src/deep.ts', lines: 3 },
            { path: 'packages/lib/src/ids.ts', lines: 2 },
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
      assert.include(stderr, 'has 3 problems')
      assert.include(
        stderr,
        'packages/lib/src/deep.ts (3 lines) is in no chunk.'
      )
      assert.include(
        stderr,
        'packages/lib/src/helper.ts (4 lines) is in no chunk.'
      )
      assert.include(
        stderr,
        'packages/lib/src/ids.ts (2 lines) is in no chunk.'
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

  it.effect(
    'lists the imports and dependents of files within the scope, through workspace packages and generated files',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace

        const { stdout, exitCode } = yield* atlas(
          root,
          'imports',
          '--root',
          'packages/app',
          'packages/lib/src/helper.ts',
          'packages/app/src/index.ts'
        )

        assert.strictEqual(exitCode, 0)
        deepStrictEqual(String.split(stdout, '\n'), [
          'packages/lib/src/helper.ts',
          '  imports      packages/lib/src/deep.ts',
          '  imported by  packages/app/src/index.ts',
          '',
          'packages/app/src/index.ts',
          '  imports      packages/app/src/lazy.ts',
          '  imports      packages/app/src/local.ts',
          '  imports      packages/app/src/page.ts',
          '  imports      packages/lib/src/helper.ts',
          '  imports      packages/lib/src/ids.ts',
          '',
        ])
      })
  )

  it.effect.each([
    {
      file: 'packages/lib/src/unused.ts',
      message:
        'packages/lib/src/unused.ts is not in the scope of packages/app.',
    },
    {
      file: 'packages/app/src/routes.gen.ts',
      message:
        'packages/app/src/routes.gen.ts is generated, so the scope of packages/app leaves it and its imports out.',
    },
  ])('names a file whose imports it cannot show: $file', ({ file, message }) =>
    Effect.gen(function* () {
      const { root } = yield* workspace

      const { stderr, exitCode } = yield* atlas(
        root,
        'imports',
        '--root',
        'packages/app',
        file
      )

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, message)
    })
  )

  it.effect(
    'labels the imports and dependents of a file with their chunks',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace

        const { stdout, exitCode } = yield* atlas(
          root,
          'imports',
          '--draft',
          yield* writeDraft(root, { ...draft, chunks: [draft.chunks[0]] }),
          'packages/app/src/index.ts'
        )

        assert.strictEqual(exitCode, 0)
        deepStrictEqual(String.split(stdout, '\n'), [
          'packages/app/src/index.ts  in entry',
          '  imports      packages/app/src/lazy.ts  in entry',
          '  imports      packages/app/src/local.ts  in entry',
          '  imports      packages/app/src/page.ts  in pages',
          '  imports      packages/lib/src/helper.ts  in no chunk',
          '  imports      packages/lib/src/ids.ts  in no chunk',
          '',
        ])
      })
  )

  it.effect(
    'reports the coupling between the chunks of a draft and the parts of each chunk',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace

        const { stdout, exitCode } = yield* atlas(
          root,
          'imports',
          '--draft',
          yield* writeDraft(root, draft)
        )

        assert.strictEqual(exitCode, 0)
        deepStrictEqual(String.split(stdout, '\n'), [
          'Imports between chunks, counted as imports between their files, with the ones the other way after a plus:',
          '  imports  chunks',
          '        2  entry -> helper',
          '    1 + 1  entry <-> pages',
          '',
          'Chunks with their files in scope, their imports inside, out to and in from other chunks, and the parts their files split into with no imports between parts:',
          '  files  inside  out  in  parts  chunk',
          '      3       2    3   1      1  entry',
          '      1       0    1   1      1  pages',
          '      3       1    0   2      2  helper',
          '',
          'helper part 1:',
          '  packages/lib/src/deep.ts',
          '  packages/lib/src/helper.ts',
          '',
          'helper part 2:',
          '  packages/lib/src/ids.ts',
          '',
        ])
      })
  )

  it.effect(
    'counts a file in several chunks toward the last and notes files in no chunk',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace

        const { stdout, stderr, exitCode } = yield* atlas(
          root,
          'imports',
          '--draft',
          yield* writeDraft(root, {
            ...draft,
            chunks: [
              draft.chunks[0],
              chunk('extra', 'packages/app/src/local.ts'),
            ],
          })
        )

        assert.strictEqual(exitCode, 0)
        assert.include(stdout, '\n      2       1    2   0      1  entry\n')
        assert.include(stdout, '\n      1       0    0   2      1  extra\n')
        assert.include(
          stderr,
          'A file is in more than one chunk and counts only toward the last chunk that lists it.'
        )
        assert.include(
          stderr,
          '3 files in scope are in no chunk, so their imports are left out.'
        )
      })
  )

  it.effect('asks to run atlas inside a git repository', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped()

      const { stderr, exitCode } = yield* atlas(directory, 'scope', '.')

      assert.strictEqual(exitCode, 1)
      assert.include(
        stderr,
        'is not inside a git repository. Run atlas from the repository you map.'
      )
    })
  )
})
