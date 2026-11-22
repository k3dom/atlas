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
}) {
  override get message(): string {
    return [
      `${this.draft} has ${this.problems.length === 1 ? 'a problem' : `${this.problems.length} problems`}:`,
      ...Array.map(this.problems, (problem) => `- ${problem}`),
      `Fix them in the draft and run \`atlas check ${this.draft}\` again.`,
    ].join('\n')
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const DraftJson = Schema.fromJsonString(Artifact.Draft)

export const chunksOf = <File>(
  nodes: ReadonlyArray<Artifact.Node<File>>
): Array<Artifact.Chunk<File>> =>
  Array.flatMap(nodes, (node) =>
    node.kind === 'group' ? chunksOf(node.children) : [node]
  )

const nodesOf = <File>(
  nodes: ReadonlyArray<Artifact.Node<File>>
): Array<Artifact.Node<File>> =>
  Array.flatMap(nodes, (node) =>
    node.kind === 'group' ? [node, ...nodesOf(node.children)] : [node]
  )

const measure = <A extends { readonly path: string }, B>(
  nodes: Array.NonEmptyReadonlyArray<Artifact.Node<A>>,
  file: (file: A) => B
): Array.NonEmptyArray<Artifact.Node<B>> =>
  Array.map(nodes, (node): Artifact.Node<B> =>
    node.kind === 'group'
      ? { ...node, children: measure(node.children, file) }
      : { ...node, files: Array.map(node.files, file) }
  )

const quote = (ids: ReadonlyArray<string>) =>
  pipe(
    ids,
    Array.map((id) => `"${id}"`),
    Array.join(' and ')
  )

/**
 * Lists what keeps a draft from being a valid map of its scope: ids used more
 * than once, files in no chunk or in several, and files outside the scope.
 */
export const problems = Effect.fnUntraced(function* (
  draft: Artifact.Draft,
  scope: ReadonlyArray<Scope.File>
) {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem
  const inScope = new Set(Array.map(scope, (file) => file.path))

  const ids = pipe(
    nodesOf(draft.chunks),
    Array.groupBy((node) => node.id),
    Record.toEntries,
    Array.filter(([, nodes]) => nodes.length > 1),
    Array.map(
      ([id, nodes]) =>
        `The id "${id}" belongs to ${nodes.length} nodes. Give each group and chunk an id of its own.`
    )
  )

  const assigned = pipe(
    chunksOf(draft.chunks),
    Array.flatMap((chunk) =>
      Array.map(chunk.files, (file) => ({ path: file.path, chunk: chunk.id }))
    ),
    Array.groupBy((file) => file.path)
  )

  const files = yield* Effect.forEach(
    Record.toEntries(assigned),
    Effect.fnUntraced(function* ([path, entries]) {
      const chunks = Array.dedupe(Array.map(entries, (entry) => entry.chunk))
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
        found.push(
          (yield* fs.exists(repository.absolute(path)))
            ? `${path} is not in the scope of ${Array.join(draft.roots, ', ')}. Remove it, or run \`atlas scope\` to list the files in scope.`
            : `${path} does not exist. Use paths relative to the repository root, as \`atlas scope\` prints them.`
        )
      }
      return found
    })
  )

  const unassigned = pipe(
    scope,
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
      return Predicate.isNumber(key)
        ? `[${key}]`
        : index === 0
          ? globalThis.String(key)
          : `.${globalThis.String(key)}`
    }),
    Array.join('')
  )

/**
 * Validates a draft against its scope and writes it as the final map, with
 * the line counts and commit measured here, to `.atlas/map.json`.
 */
export const run = Effect.fn('Check.run')(function* (draftPath: string) {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem

  const draft = yield* fs.readFileString(draftPath).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(DraftJson)(text, {
        errors: 'all',
        onExcessProperty: 'error',
      })
    ),
    Effect.catchTags({
      PlatformError: (error) =>
        new DraftError({
          draft: draftPath,
          problems: [`It can't be read: ${error.message}`],
        }),
      SchemaError: (error) =>
        new DraftError({
          draft: draftPath,
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
        }),
    })
  )

  const scope = yield* Scope.resolve(draft.roots)
  const found = yield* problems(draft, scope.files)
  if (Array.isArrayNonEmpty(found)) {
    return yield* new DraftError({ draft: draftPath, problems: found })
  }

  const lines = Record.fromIterableWith(scope.files, (file) => [
    file.path,
    file.lines,
  ])
  const artifact: Artifact.Artifact = {
    version: 1,
    commit: yield* repository.head(),
    roots: draft.roots,
    chunks: measure(draft.chunks, (file) => ({
      ...file,
      lines: lines[file.path] ?? 0,
    })),
  }
  const target = repository.absolute('.atlas/map.json')
  yield* fs.makeDirectory(repository.absolute('.atlas'), { recursive: true })
  yield* fs.writeFileString(
    target,
    `${JSON.stringify(yield* Schema.encodeEffect(Artifact.Artifact)(artifact), null, 2)}\n`
  )
  return {
    artifact,
    path: repository.relative(target),
    changed: yield* repository.changed(
      Array.map(scope.files, (file) => file.path)
    ),
  }
})
