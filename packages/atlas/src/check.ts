import {
  Array,
  Effect,
  FileSystem,
  pipe,
  Predicate,
  Record,
  Schema,
  SchemaIssue,
  String,
} from 'effect'
import { CliError } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Repository from '#/repository.ts'
import * as Scope from '#/scope.ts'

export class DraftError extends Schema.TaggedError<DraftError>()('DraftError', {
  draft: Schema.String,
  problems: Schema.NonEmptyArray(Schema.String),
  command: Schema.Literals(['check', 'imports']),
}) {
  override get message(): string {
    return Array.join(
      [
        `${this.draft} has ${this.problems.length === 1 ? 'a problem' : `${this.problems.length} problems`}:`,
        ...Array.map(this.problems, (problem) => `- ${problem}`),
        `Fix the draft and run \`atlas ${this.command === 'check' ? 'check' : 'imports --draft'} ${this.draft}\` again.`,
      ],
      '\n'
    )
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const quote = (ids: ReadonlyArray<string>) =>
  pipe(
    ids,
    Array.map((id) => `"${id}"`),
    Array.join(' and ')
  )

const problems = Effect.fnUntraced(function* (
  draft: Artifact.Draft,
  scope: Scope.Scope
) {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem
  const inScope = new Set(Array.map(scope.files, (file) => file.path))
  const ids = pipe(
    Artifact.nodes(draft.chunks),
    Array.groupBy((node) => node.id),
    Record.toEntries,
    Array.filter(([, nodes]) => nodes.length > 1),
    Array.map(
      ([id, nodes]) =>
        `The id "${id}" belongs to ${nodes.length} nodes. Give each group and chunk an id of its own.`
    )
  )

  const assigned = pipe(
    Artifact.chunks(draft.chunks),
    Array.flatMap((chunk) =>
      Array.map(chunk.files, (file) => ({ path: file.path, chunk: chunk.id }))
    ),
    Array.groupBy((file) => file.path)
  )

  const files = yield* Effect.forEach(
    Record.toEntries(assigned),
    Effect.fnUntraced(function* ([path, entries]) {
      const chunks = pipe(
        entries,
        Array.map((entry) => entry.chunk),
        Array.dedupe
      )
      const found: Array<string> = []
      if (chunks.length > 1) {
        found.push(
          `${path} is in the chunks ${quote(chunks)}. Keep it only in the chunk of its main concern, and mark it mixed there.`
        )
      } else if (entries.length > 1) {
        found.push(
          `${path} is listed ${entries.length} times in the chunk ${quote(chunks)}. List it once.`
        )
      }
      if (!inScope.has(path)) {
        const exists = yield* fs
          .exists(repository.absolute(path))
          .pipe(Effect.orDie)
        found.push(
          exists
            ? `${path} is not in the scope of ${Array.join(scope.roots, ', ')}. Remove it, or run \`atlas scope\` to list the files in scope.`
            : `${path} does not exist. Use paths relative to the repository root, as \`atlas scope\` prints them.`
        )
      }
      return found
    })
  )

  const unassigned = pipe(
    scope.files,
    Array.filter((file) => !Record.has(assigned, file.path)),
    Array.map(
      (file) =>
        `${file.path} (${file.lines} lines) is in no chunk. Add it to the chunk of its main concern.`
    )
  )

  return [...ids, ...Array.flatten(files), ...unassigned]
})

const formatPath = (
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
) =>
  pipe(
    path,
    Array.map((segment, index) => {
      const key = Predicate.isObject(segment) ? segment.key : segment
      if (Predicate.isNumber(key)) {
        return `[${key}]`
      }
      return index === 0 ? globalThis.String(key) : `.${globalThis.String(key)}`
    }),
    Array.join('')
  )

export const read = Effect.fn('Check.read')(function* (
  draftPath: string,
  command: DraftError['command']
) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(draftPath).pipe(Effect.orDie)
  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Artifact.Draft)
  )(text, { errors: 'all', onExcessProperty: 'error' }).pipe(
    Effect.catchTag(
      'SchemaError',
      (error) =>
        new DraftError({
          draft: draftPath,
          command,
          problems: pipe(
            SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues,
            Array.map(({ path = [], message }) =>
              Array.isReadonlyArrayNonEmpty(path)
                ? `${formatPath(path)}: ${message}`
                : message
            ),
            (messages) =>
              Array.isArrayNonEmpty(messages)
                ? messages
                : [String.trim(error.message)]
          ),
        })
    )
  )
})

export const run = Effect.fn('Check.run')(function* (draftPath: string) {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem
  const draft = yield* read(draftPath, 'check')

  const scope = yield* Scope.resolve(draft.roots)
  const found = yield* problems(draft, scope)
  if (Array.isArrayNonEmpty(found)) {
    return yield* new DraftError({
      draft: draftPath,
      problems: found,
      command: 'check',
    })
  }

  const lines = Record.fromIterableWith(scope.files, (file) => [
    file.path,
    file.lines,
  ])
  const artifact: Artifact.Artifact = {
    version: 1,
    commit: yield* repository.head(),
    roots: scope.roots,
    chunks: Artifact.mapFiles(draft.chunks, (file) => ({
      ...file,
      lines: lines[file.path] ?? 0,
    })),
  }
  const encoded = yield* Schema.encodeEffect(Artifact.Artifact)(artifact).pipe(
    Effect.orDie
  )
  const target = repository.absolute('.atlas/map.json')
  yield* fs
    .makeDirectory(repository.absolute('.atlas'), { recursive: true })
    .pipe(Effect.orDie)
  yield* fs
    .writeFileString(target, `${JSON.stringify(encoded, null, 2)}\n`)
    .pipe(Effect.orDie)
  return {
    artifact,
    path: repository.relative(target),
    changed: yield* repository.changed(
      Array.map(scope.files, (file) => file.path)
    ),
  }
})
