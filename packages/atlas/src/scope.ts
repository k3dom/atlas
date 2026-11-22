import {
  Array,
  Effect,
  FileSystem,
  Order,
  Path,
  pipe,
  Predicate,
  Schema,
  String,
} from 'effect'
import { CliError } from 'effect/cli'
import { parseSync } from 'oxc-parser'
import { ResolverFactory } from 'oxc-resolver'

import * as Repository from '#/repository.ts'

export interface File {
  readonly path: string
  readonly lines: number
}

export interface Import {
  readonly from: string
  readonly specifier: string
}

export class RootError extends Schema.TaggedError<RootError>()('RootError', {
  root: Schema.String,
  reason: Schema.Literals(['outside', 'empty']),
}) {
  override get message(): string {
    return this.reason === 'outside'
      ? `The root ${this.root} is outside the repository. Pass a directory inside it.`
      : `The root ${this.root} holds no source files tracked by git. Pass a directory with source files, such as a package.`
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const isCode = (file: string) => /\.[cm]?[jt]sx?$/u.test(file)

const isTest = (file: string) =>
  /(?:^|\/)(?:test|tests|__tests__|__mocks__)\/|\.(?:test|spec)\.[^/]+$/u.test(
    file
  )

const isConfig = (file: string) => /(?:^|\/)[^/]+\.config\.[^/]+$/u.test(file)

const isGenerated = (source: string) =>
  /@generated|auto-?generated|automatically generated|do not edit/iu.test(
    String.slice(0, 1000)(source)
  )

const countLines = (source: string) =>
  pipe(String.linesIterator(source), Array.fromIterable, Array.length)

const specifiers = (file: string, source: string) => {
  const { module } = parseSync(file, source)
  return pipe(
    [
      ...Array.map(module.staticImports, (i) => i.moduleRequest.value),
      ...pipe(
        module.staticExports,
        Array.flatMap((e) => e.entries),
        Array.flatMapNullishOr((entry) => entry.moduleRequest?.value)
      ),
      ...Array.flatMapNullishOr(
        module.dynamicImports,
        (i) =>
          /^(['"`])([^'"`$]+)\1$/u.exec(
            String.slice(i.moduleRequest.start, i.moduleRequest.end)(source)
          )?.[2]
      ),
    ],
    Array.dedupe
  )
}

/**
 * Lists the source files of the roots and every workspace file they import,
 * directly or transitively, leaving out tests, tool configs and generated files.
 */
export const resolve = Effect.fn('Scope.resolve')(function* (
  roots: ReadonlyArray<string>
) {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const tracked = yield* repository.tracked()
  const resolver = new ResolverFactory({
    tsconfig: 'auto',
    conditionNames: ['import', 'module', 'node', 'default'],
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    },
    builtinModules: true,
  })

  const inScope = (file: string) =>
    tracked.has(file) && isCode(file) && !isTest(file)

  const starts = yield* Effect.forEach(roots, (root) => {
    if (String.startsWith('..')(root) || path.isAbsolute(root)) {
      return Effect.fail(new RootError({ root, reason: 'outside' }))
    }
    const prefix = root === '.' ? '' : `${root}/`
    const files = Array.filter(
      Array.fromIterable(tracked),
      (file) => String.startsWith(prefix)(file) && inScope(file)
    )
    if (!Array.isReadonlyArrayNonEmpty(files)) {
      return Effect.fail(new RootError({ root, reason: 'empty' }))
    }
    return Effect.succeed(Array.filter(files, (file) => !isConfig(file)))
  })

  const visit = Effect.fnUntraced(function* (file: string) {
    const absolute = repository.absolute(file)
    const source = yield* fs.readFileString(absolute)
    const resolved = Array.map(specifiers(absolute, source), (specifier) => ({
      specifier,
      result: resolver.resolveFileSync(absolute, specifier),
    }))
    return {
      file: { path: file, lines: countLines(source) },
      generated: isGenerated(source),
      imports: pipe(
        resolved,
        Array.flatMapNullishOr(({ result }) => result.path),
        Array.map((target) => path.relative(repository.root, target)),
        Array.filter(inScope)
      ),
      unresolved: pipe(
        resolved,
        Array.filter(
          ({ result }) =>
            Predicate.isUndefined(result.path) &&
            Predicate.isUndefined(result.builtin)
        ),
        Array.map(({ specifier }): Import => ({ from: file, specifier }))
      ),
    }
  })

  const seen = new Set<string>(Array.flatten(starts))
  const files: Array<File> = []
  const unresolved: Array<Import> = []
  let frontier = Array.fromIterable(seen)
  while (Array.isArrayNonEmpty(frontier)) {
    const visited = yield* Effect.forEach(frontier, visit, {
      concurrency: 16,
    })
    frontier = []
    for (const result of visited) {
      if (!result.generated) {
        files.push(result.file)
      }
      unresolved.push(...result.unresolved)
      for (const target of result.imports) {
        if (!seen.has(target)) {
          seen.add(target)
          frontier.push(target)
        }
      }
    }
  }

  return {
    files: Array.sort(
      files,
      Order.mapInput(Order.String, (file: File) => file.path)
    ),
    unresolved,
  }
})
