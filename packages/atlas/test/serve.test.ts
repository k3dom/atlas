import { NodeServices } from '@effect/platform-node'
import { assert, layer } from '@effect/vitest'
import { deepStrictEqual } from '@effect/vitest/utils'
import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  pipe,
  Schema,
  String,
} from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'

import * as Artifact from '#/artifact.ts'
import { atlas, serve, workspace } from '#test/fixture.ts'

const map = {
  version: 1,
  commit: 'cfd0bfad3fc6d20cf2231347d717e0d02acbc79c',
  roots: ['packages/app'],
  chunks: [
    {
      kind: 'chunk',
      id: 'templates',
      name: 'Templates',
      summary: 'Renders pages and closes each with </script> and </html>.',
      tier: 2,
      rationale: 'Some branching.',
      essential: 70,
      files: [{ path: 'packages/app/src/index.ts', lines: 7 }],
    },
  ],
  history: [],
} as const

const writeMap = Effect.fnUntraced(function* (file: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  yield* fs.writeFileString(file, JSON.stringify(value, null, 2))
})

const embedded = Effect.fnUntraced(function* (url: string) {
  const client = yield* HttpClient.HttpClient
  const html = yield* client
    .get(url)
    .pipe(Effect.flatMap((response) => response.text))
  const text = pipe(
    html,
    String.match(/<script id="map" type="application\/json">(.*?)<\/script>/s),
    Option.flatMap((match) => Option.fromNullishOr(match[1]))
  )
  return yield* Option.match(text, {
    onNone: () => Effect.die(`The viewer has no map embedded: ${html}`),
    onSome: Schema.decodeUnknownEffect(
      Schema.fromJsonString(Artifact.Artifact)
    ),
  })
})

layer(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer), {
  timeout: 60_000,
})('atlas serve', (it) => {
  it.effect(
    'serves the viewer with the map of the current repository loaded, from any directory in it',
    () =>
      Effect.gen(function* () {
        const { root } = yield* workspace
        const path = yield* Path.Path
        const client = yield* HttpClient.HttpClient
        yield* writeMap(path.join(root, '.atlas/map.json'), map)

        const url = yield* serve(path.join(root, 'packages/app/src'))

        deepStrictEqual(yield* embedded(url), map)
        const script = yield* client
          .get(`${url}/assets/viewer.js`)
          .pipe(Effect.flatMap((response) => response.text))
        assert.strictEqual(script, "export const viewer = 'atlas'\n")
      })
  )

  it.effect('serves the map at a path outside of any repository', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped()
      yield* writeMap(path.join(dir, 'maps/club.json'), map)

      const url = yield* serve(dir, 'maps/club.json')

      deepStrictEqual(yield* embedded(url), map)
    })
  )

  it.effect('serves the map as it is on disk when the viewer loads', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped()
      const file = path.join(dir, 'map.json')
      yield* writeMap(file, map)
      const url = yield* serve(dir, 'map.json')

      const rewritten = {
        ...map,
        roots: ['packages/app', 'packages/lib'] as const,
      }
      yield* writeMap(file, rewritten)

      deepStrictEqual(yield* embedded(url), rewritten)
    })
  )

  it.effect('reports a repository without a map', () =>
    Effect.gen(function* () {
      const { root } = yield* workspace

      const { stderr, exitCode } = yield* atlas(root, 'serve', '--no-open')

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, 'has no map at .atlas/map.json yet.')
    })
  )

  it.effect('asks for a map outside of any repository', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()

      const { stderr, exitCode } = yield* atlas(dir, 'serve', '--no-open')

      assert.strictEqual(exitCode, 1)
      assert.include(
        stderr,
        `${dir} is not inside a git repository, so it has no map to serve.`
      )
    })
  )

  it.effect('names the fields of a map that breaks the schema', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped()
      yield* writeMap(path.join(dir, 'map.json'), {
        ...map,
        chunks: [{ ...map.chunks[0], tier: 5 }],
      })

      const { stderr, exitCode } = yield* atlas(
        dir,
        'serve',
        '--no-open',
        'map.json'
      )

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, "map.json isn't a valid atlas map:")
      assert.include(stderr, '- chunks[0].tier: Expected 1 | 2 | 3 | 4')
    })
  )

  it.effect('reports a port that is in use', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped()
      yield* writeMap(path.join(dir, 'map.json'), map)
      const { port } = new URL(yield* serve(dir, 'map.json'))

      const { stderr, exitCode } = yield* atlas(
        dir,
        'serve',
        '--no-open',
        '--port',
        port,
        'map.json'
      )

      assert.strictEqual(exitCode, 1)
      assert.include(stderr, `Port ${port} is in use.`)
    })
  )
})
