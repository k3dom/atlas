import { Effect, FileSystem, Path, Record, Stream, String } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const files = {
  '.gitignore': 'node_modules\n',
  'packages/app/package.json': JSON.stringify({
    name: '@ws/app',
    type: 'module',
    imports: { '#/*': './src/*' },
  }),
  'packages/app/vitest.config.ts': "import '@ws/lib/config'\n",
  'packages/app/src/index.ts': [
    "import { helper } from '@ws/lib/helper'",
    "import { routes } from '#/routes.gen.ts'",
    "export * from './local.ts'",
    "const lazy = () => import('./lazy.ts')",
    "import 'missing-package'",
    'export const run = () => [helper, routes, lazy]',
    '',
  ].join('\n'),
  'packages/app/src/local.ts': 'export const local = 1\n',
  'packages/app/src/lazy.ts': 'export const lazy = 1\n',
  'packages/app/src/page.ts': 'export const page = 1\n',
  'packages/app/src/routes.gen.ts': [
    '// This file was automatically generated. Do not edit.',
    "import { page } from './page.ts'",
    'export const routes = [page]',
    '',
  ].join('\n'),
  'packages/app/src/index.test.ts': "import '@ws/lib/tested'\n",
  'packages/app/test/setup.ts': "import '@ws/lib/tested'\n",
  'packages/lib/package.json': JSON.stringify({
    name: '@ws/lib',
    type: 'module',
    exports: { './*': './src/*.ts' },
  }),
  'packages/lib/src/helper.ts': [
    "import type { Deep } from './deep.ts'",
    "import 'node:path'",
    'export const helper = (deep: Deep) => deep',
    '',
  ].join('\n'),
  'packages/lib/src/deep.ts': 'export type Deep = {\n  value: number\n}\n',
  'packages/lib/src/config.ts': 'export const config = 1\n',
  'packages/lib/src/tested.ts': 'export const tested = 1\n',
  'packages/lib/src/unused.ts': 'export const unused = 1\n',
}

/**
 * A git repository of a workspace with an app that imports from a library,
 * linked the way pnpm links workspace packages.
 */
export const workspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const root = yield* fs.makeTempDirectoryScoped()
  const git = (...args: ReadonlyArray<string>) =>
    spawner.string(ChildProcess.make('git', args, { cwd: root }))

  yield* Effect.forEach(Record.toEntries(files), ([file, content]) =>
    Effect.andThen(
      fs.makeDirectory(path.dirname(path.join(root, file)), {
        recursive: true,
      }),
      fs.writeFileString(path.join(root, file), content)
    )
  )
  yield* fs.makeDirectory(path.join(root, 'packages/app/node_modules/@ws'), {
    recursive: true,
  })
  yield* fs.symlink(
    '../../../lib',
    path.join(root, 'packages/app/node_modules/@ws/lib')
  )
  yield* git('init', '--quiet')
  yield* git('config', 'user.email', 'test@example.com')
  yield* git('config', 'user.name', 'Test')
  yield* git('add', '.')
  yield* git('commit', '--quiet', '-m', 'init')
  return { root, commit: String.trim(yield* git('rev-parse', 'HEAD')) }
})

/**
 * Runs the atlas CLI in a directory, the way a person or agent would.
 */
export const atlas = Effect.fnUntraced(function* (
  cwd: string,
  ...args: ReadonlyArray<string>
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const path = yield* Path.Path
  const handle = yield* spawner.spawn(
    ChildProcess.make(
      'node',
      [path.join(import.meta.dirname, '../src/index.ts'), ...args],
      { cwd }
    )
  )
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: 'unbounded' }
  )
  return { stdout, stderr, exitCode }
}, Effect.scoped)
