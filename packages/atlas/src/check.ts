import {
  Array,
  Effect,
  FileSystem,
  Option,
  Order,
  pipe,
  Record,
  Schema,
} from 'effect'
import { CliError } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Repository from '#/repository.ts'
import * as Scope from '#/scope.ts'
import * as Store from '#/store.ts'

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

export class UncommittedError extends Schema.TaggedError<UncommittedError>()(
  'UncommittedError',
  { files: Schema.NonEmptyArray(Schema.String) }
) {
  override get message(): string {
    return Array.join(
      [
        `${this.files.length === 1 ? 'A file' : `${this.files.length} files`} in scope ${this.files.length === 1 ? 'differs' : 'differ'} from HEAD. The history of the map records the events of an update at the commit with the changes they describe, so commit ${this.files.length === 1 ? 'it' : 'them'} and run check again:`,
        ...Array.map(this.files, (file) => `  ${file}`),
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

const describe = Artifact.Event.match({
  add: (event) => `adds "${event.chunk}"`,
  remove: (event) => `removes "${event.chunk}"`,
  revise: (event) => `revises "${event.chunk}"`,
  rename: (event) => `renames "${event.from}" to "${event.to}"`,
  split: (event) => `splits "${event.from}" into ${quote(event.into)}`,
  merge: (event) => `merges ${quote(event.from)} into "${event.into}"`,
})

const listed = (
  chunk: Artifact.Chunk<{ readonly path: string; readonly mixed?: boolean }>
) =>
  pipe(
    chunk.files,
    Array.map((file) => `${file.path}${file.mixed === true ? ' mixed' : ''}`),
    Array.sort(Order.String),
    Array.join('\n')
  )

const differences = (
  before: Artifact.Chunk<Artifact.MeasuredFile>,
  after: Artifact.Chunk<{ readonly path: string; readonly mixed?: boolean }>
) =>
  Array.filter(
    ['name', 'summary', 'tier', 'rationale', 'essential', 'files'] as const,
    (field) =>
      field === 'files'
        ? listed(before) !== listed(after)
        : before[field] !== after[field]
  )

const eventProblems = (
  draft: Artifact.Draft,
  previous: Option.Option<Artifact.Artifact>
): Array<string> => {
  if (Option.isNone(previous)) {
    return Array.isReadonlyArrayNonEmpty(draft.events)
      ? [
          `The draft has events, but there is no map at ${Store.path} for them to refer to. Remove the events to build a new map.`,
        ]
      : []
  }
  const at = `the map at ${Artifact.short(previous.value.commit)}`
  const before = new Map(
    Array.map(Artifact.chunks(previous.value.chunks), (chunk) => [
      chunk.id,
      chunk,
    ])
  )
  const after = new Map(
    Array.map(Artifact.chunks(draft.chunks), (chunk) => [chunk.id, chunk])
  )

  const named = Array.flatMap(draft.events, (event, index) => {
    const label = `events[${index}], which ${describe(event)},`
    const from = Artifact.sources(event)
    const to = Artifact.targets(event)
    const revised =
      event.kind === 'revise'
        ? { before: before.get(event.chunk), after: after.get(event.chunk) }
        : undefined
    const unchanged =
      revised?.before !== undefined &&
      revised.after !== undefined &&
      !Array.isArrayNonEmpty(differences(revised.before, revised.after))
    return [
      ...pipe(
        from,
        Array.filter((id) => !before.has(id)),
        Array.map(
          (id) =>
            `${label} names "${id}", which is no chunk of ${at}. Start events from the ids of the chunks in ${Store.path}.`
        )
      ),
      ...pipe(
        to,
        Array.filter((id) => !after.has(id)),
        Array.map(
          (id) =>
            `${label} names "${id}", which is no chunk of the draft. Use the ids of the chunks the event leads to.`
        )
      ),
      ...pipe(
        from,
        Array.filter(
          (id) => !Array.contains(to, id) && before.has(id) && after.has(id)
        ),
        Array.map(
          (id) =>
            `${label} ends "${id}", but the draft still has a chunk with that id. Drop the chunk, or record a split or merge that keeps its id.`
        )
      ),
      ...pipe(
        to,
        Array.filter(
          (id) => !Array.contains(from, id) && before.has(id) && after.has(id)
        ),
        Array.map(
          (id) =>
            `${label} makes "${id}" a new chunk, but ${at} already has it. Record a revise event for a chunk that keeps its id.`
        )
      ),
      ...(unchanged
        ? [`${label} but the chunk is the same as in ${at}. Remove the event.`]
        : []),
      ...(event.kind === 'rename' && event.from === event.to
        ? [
            `${label} but keeps the id. Record a revise event for a chunk that keeps its id.`,
          ]
        : []),
    ]
  })

  const involved = pipe(
    draft.events,
    Array.flatMap((event, index) =>
      pipe(
        [...Artifact.sources(event), ...Artifact.targets(event)],
        Array.dedupe,
        Array.map((id) => ({ id, label: `events[${index}]` }))
      )
    ),
    Array.groupBy((entry) => entry.id)
  )
  const repeated = pipe(
    Record.toEntries(involved),
    Array.filter(([, entries]) => entries.length > 1),
    Array.map(
      ([id, entries]) =>
        `"${id}" takes part in ${Array.join(
          Array.map(entries, (entry) => entry.label),
          ' and '
        )}. Record each change to a chunk in one event, such as a split that also revises the chunk that keeps its id.`
    )
  )

  const ended = new Set(Array.flatMap(draft.events, Artifact.sources))
  const started = new Set(Array.flatMap(draft.events, Artifact.targets))
  const kept = new Set(
    Array.flatMap(draft.events, (event) =>
      Array.intersection(Artifact.sources(event), Artifact.targets(event))
    )
  )
  const gone = pipe(
    Array.fromIterable(before.keys()),
    Array.filter((id) => !after.has(id) && !ended.has(id)),
    Array.map(
      (id) =>
        `The chunk "${id}" of ${at} is not in the draft. Record why with a remove, rename, split or merge event.`
    )
  )
  const fresh = pipe(
    Array.fromIterable(after.keys()),
    Array.filter((id) => !before.has(id) && !started.has(id)),
    Array.map(
      (id) =>
        `"${id}" is a new chunk. Record why with an add event, or with a rename, split or merge event if it continues chunks of ${at}.`
    )
  )
  const changed = pipe(
    Array.fromIterable(after),
    Array.flatMap(([id, chunk]) => {
      const previousChunk = before.get(id)
      if (previousChunk === undefined || kept.has(id)) {
        return []
      }
      const fields = differences(previousChunk, chunk)
      return Array.isArrayNonEmpty(fields)
        ? [
            `The chunk "${id}" differs from ${at} in its ${Array.join(fields, ', ')}. Record why with a revise event.`,
          ]
        : []
    })
  )

  return [...named, ...repeated, ...gone, ...fresh, ...changed]
}

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
          problems: Artifact.problems(error.issue),
        })
    )
  )
})

export const run = Effect.fn('Check.run')(function* (draftPath: string) {
  const repository = yield* Repository.Repository
  const draft = yield* read(draftPath, 'check')

  const scope = yield* Scope.resolve(draft.roots)
  const previous = yield* Store.find()
  const found = [
    ...(yield* problems(draft, scope)),
    ...eventProblems(draft, previous),
  ]
  if (Array.isArrayNonEmpty(found)) {
    return yield* new DraftError({
      draft: draftPath,
      problems: found,
      command: 'check',
    })
  }

  const changed = yield* repository.changed(
    Array.map(scope.files, (file) => file.path)
  )
  if (
    Option.isSome(previous) &&
    Array.isReadonlyArrayNonEmpty(draft.events) &&
    Array.isArrayNonEmpty(changed)
  ) {
    return yield* new UncommittedError({ files: changed })
  }

  const lines = Record.fromIterableWith(scope.files, (file) => [
    file.path,
    file.lines,
  ])
  const commit = yield* repository.head()
  const artifact: Artifact.Artifact = {
    version: 1,
    commit,
    roots: scope.roots,
    chunks: Artifact.mapFiles(draft.chunks, (file) => ({
      ...file,
      lines: lines[file.path] ?? 0,
    })),
    history: [
      ...Option.match(previous, {
        onNone: () => [],
        onSome: (map) => map.history,
      }),
      ...(Array.isReadonlyArrayNonEmpty(draft.events)
        ? [{ commit, events: draft.events }]
        : []),
    ],
  }
  yield* Store.write(artifact)
  return { artifact, previous, events: draft.events, changed }
})
