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

export interface Scope {
  readonly roots: Array.NonEmptyReadonlyArray<string>
  readonly files: ReadonlyArray<File>
  readonly generated: ReadonlyArray<string>
  readonly unresolved: ReadonlyArray<Import>
  readonly untracked: ReadonlyArray<Import>
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

const isSource = (file: string) =>
  /\.[cm]?[jt]sx?$/u.test(file) &&
  !/(?:^|\/)(?:test|tests|__tests__|__mocks__)\/|\.(?:test|spec)\.[^/]+$/u.test(
    file
  )

const inWorkspace = (target: string) =>
  !String.startsWith('..')(target) &&
  !/(?:^|\/)node_modules\//u.test(target) &&
  isSource(target)

export const resolve = Effect.fn('Scope.resolve')(function* (
  input: Array.NonEmptyReadonlyArray<string>
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

  const roots = pipe(
    input,
    Array.map((root) =>
      pipe(path.normalize(root), String.replace(/(?<=.)\/+$/u, ''))
    ),
    Array.dedupe
  )

  const starts = yield* Effect.forEach(
    roots,
    Effect.fnUntraced(function* (root) {
      if (String.startsWith('..')(root) || path.isAbsolute(root)) {
        return yield* new RootError({ root, reason: 'outside' })
      }
      const prefix = root === '.' ? '' : `${root}/`
      const files = pipe(
        Array.fromIterable(tracked),
        Array.filter(
          (file) => String.startsWith(prefix)(file) && isSource(file)
        )
      )
      if (!Array.isReadonlyArrayNonEmpty(files)) {
        return yield* new RootError({ root, reason: 'empty' })
      }
      return Array.filter(
        files,
        (file) => !/(?:^|\/)[^/]+\.config\.[^/]+$/u.test(file)
      )
    })
  )

  const visit = Effect.fnUntraced(function* (file: string) {
    const absolute = repository.absolute(file)
    const source = yield* fs.readFileString(absolute).pipe(Effect.orDie)
    const imports = Array.map(specifiers(absolute, source), (specifier) => {
      const result = resolver.resolveFileSync(absolute, specifier)
      const target = Predicate.isUndefined(result.path)
        ? undefined
        : path.relative(repository.root, result.path)
      return { from: file, specifier, builtin: result.builtin, target }
    })
    return {
      file: {
        path: file,
        lines: pipe(
          String.linesIterator(source),
          Array.fromIterable,
          Array.length
        ),
      },
      generated:
        /@generated\b|\b(?:this|the) (?:file|code) (?:is|was|has been) (?:automatically |auto-?)generated\b|\bauto-?generated (?:file|code)\b|\bdo not (?:edit|modify) (?:this file|manually)\b/iu.test(
          String.slice(0, 1000)(source)
        ),
      follow: Array.flatMapNullishOr(imports, ({ target }) =>
        Predicate.isNotUndefined(target) &&
        inWorkspace(target) &&
        tracked.has(target)
          ? target
          : undefined
      ),
      unresolved: Array.filter(
        imports,
        ({ target, builtin }) =>
          Predicate.isUndefined(target) && Predicate.isUndefined(builtin)
      ),
      untracked: Array.filter(
        imports,
        ({ target }) =>
          Predicate.isNotUndefined(target) &&
          inWorkspace(target) &&
          !tracked.has(target)
      ),
    }
  })

  const seen = new Set<string>(Array.flatten(starts))
  const files: Array<File> = []
  const generated: Array<string> = []
  const unresolved: Array<Import> = []
  const untracked: Array<Import> = []
  let frontier = Array.fromIterable(seen)
  while (Array.isArrayNonEmpty(frontier)) {
    const visited = yield* Effect.forEach(frontier, visit, {
      concurrency: 16,
    })
    frontier = []
    for (const result of visited) {
      if (result.generated) {
        generated.push(result.file.path)
      } else {
        files.push(result.file)
      }
      unresolved.push(...result.unresolved)
      untracked.push(...result.untracked)
      for (const target of result.follow) {
        if (!seen.has(target)) {
          seen.add(target)
          frontier.push(target)
        }
      }
    }
  }

  return {
    roots,
    files: Array.sort(
      files,
      Order.mapInput(Order.String, (file: File) => file.path)
    ),
    generated: Array.sort(generated, Order.String),
    unresolved: Array.map(unresolved, ({ from, specifier }) => ({
      from,
      specifier,
    })),
    untracked: Array.map(untracked, ({ from, specifier }) => ({
      from,
      specifier,
    })),
  }
})
