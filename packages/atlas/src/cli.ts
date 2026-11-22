import {
  Array,
  Console,
  Effect,
  JsonSchema,
  Number,
  Option,
  pipe,
  Record,
  Result,
  Schema,
  String,
  Struct,
} from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Changes from '#/changes.ts'
import * as Check from '#/check.ts'
import * as Imports from '#/imports.ts'
import * as Repository from '#/repository.ts'
import * as Scope from '#/scope.ts'
import * as Serve from '#/serve.ts'
import * as Store from '#/store.ts'

const schema = Command.make(
  'schema',
  {
    artifact: Flag.Boolean('artifact').pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        'Print the schema of the final map that `check` writes, with line counts and the commit, instead of the draft'
      )
    ),
  },
  ({ artifact }) => {
    const document = Schema.toJsonSchemaDocument(
      artifact ? Artifact.Artifact : Artifact.Draft,
      { onExcessProperty: 'error' }
    )
    return Console.log(
      JSON.stringify(
        {
          $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
          ...document.schema,
          $defs: document.definitions,
        },
        null,
        2
      )
    )
  }
).pipe(Command.withDescription('Print the JSON Schema of a draft map'))

const list = (heading: string, items: ReadonlyArray<string>) =>
  Array.isReadonlyArrayNonEmpty(items)
    ? Console.error(
        Array.join([heading, ...Array.map(items, (item) => `  ${item}`)], '\n')
      )
    : Effect.void

const scope = Command.make(
  'scope',
  {
    roots: Argument.Directory('root', { mustExist: true }).pipe(
      Argument.atLeast(1),
      Argument.filterMap(
        Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
        () => 'Pass at least one root.'
      ),
      Argument.withDescription(
        'Directory whose files are in scope, such as a package'
      )
    ),
  },
  Effect.fnUntraced(function* ({ roots }) {
    const repository = yield* Repository.Repository
    const result = yield* Scope.resolve(Array.map(roots, repository.relative))
    const width = pipe(
      result.files,
      Array.map((file) => globalThis.String(file.lines).length),
      Array.reduce(0, (a, b) => Number.max(a, b))
    )
    for (const file of result.files) {
      yield* Console.log(
        `${String.padStart(width)(globalThis.String(file.lines))}  ${file.path}`
      )
    }
    yield* Console.error(
      `${result.files.length} files with ${Number.sumAll(Array.map(result.files, (file) => file.lines))} lines in the scope of ${Array.join(result.roots, ', ')}.`
    )
    yield* list(
      `Left out ${result.generated.length} generated files:`,
      result.generated
    )
    yield* list(
      `${result.unresolved.length} imports could not be resolved, so files they point to may be missing:`,
      Array.map(result.unresolved, (i) => `${i.specifier} from ${i.from}`)
    )
    yield* list(
      `${result.untracked.length} imports point to files git doesn't track, such as build output or new files, so they are left out:`,
      Array.map(result.untracked, (i) => `${i.specifier} from ${i.from}`)
    )
  })
).pipe(
  Command.withDescription(
    'List the files in scope of the roots with their line counts: the source files of the roots and every workspace file they import, directly or transitively, without tests, tool configs and generated files'
  ),
  Command.provide(Repository.layer)
)

const check = Command.make(
  'check',
  {
    draft: Argument.File('draft', { mustExist: true }).pipe(
      Argument.withDescription('Draft map to validate')
    ),
  },
  Effect.fnUntraced(function* ({ draft }) {
    const { artifact, previous, events, changed } = yield* Check.run(draft)
    const nodes = Artifact.nodes(artifact.chunks)
    const chunks = Artifact.chunks(artifact.chunks)
    const files = Array.flatMap(chunks, (chunk) => chunk.files)
    const tiers = pipe(
      [1, 2, 3, 4] as const,
      Array.map(
        (tier) =>
          `${Array.filter(chunks, (chunk) => chunk.tier === tier).length} in tier ${tier}`
      ),
      Array.join(', ')
    )
    yield* Console.error(
      `Wrote ${Store.path} at ${artifact.commit}: ${nodes.length - chunks.length} groups, ${chunks.length} chunks (${tiers}), ${files.length} files and ${Number.sumAll(Array.map(files, (file) => file.lines))} lines.`
    )
    if (Option.isSome(previous)) {
      const at = `the map at ${Artifact.short(previous.value.commit)}`
      yield* Console.error(
        Array.isReadonlyArrayNonEmpty(events)
          ? `Recorded ${events.length === 1 ? 'an event' : `${events.length} events`} since ${at}: ${pipe(
              Artifact.Event.discriminants,
              Array.flatMap((kind) => {
                const n = Array.countBy(events, (event) => event.kind === kind)
                return n > 0 ? [`${n} ${kind}`] : []
              }),
              Array.join(', ')
            )}.`
          : `The chunks are the same as in ${at}.`
      )
    }
    if (Array.isArrayNonEmpty(changed)) {
      yield* Console.error(
        Array.join(
          [
            `${changed.length} files in scope differ from ${artifact.commit}, so their line counts describe the working tree. Commit them and run check again for a map of a commit:`,
            ...Array.map(changed, (file) => `  ${file}`),
          ],
          '\n'
        )
      )
    }
  })
).pipe(
  Command.withDescription(
    'Validate a draft map against its scope and the events against the map in .atlas/map.json, and write the draft there with measured line counts, the commit and the events added to its history'
  ),
  Command.provide(Repository.layer)
)

class ImportsUsage extends Schema.TaggedError<ImportsUsage>()('ImportsUsage', {
  reason: Schema.Literals(['no-scope', 'both', 'no-files']),
}) {
  override get message(): string {
    switch (this.reason) {
      case 'no-scope':
        return 'Pass --root with the files whose imports to show, or --draft to take the scope and chunks from a draft.'
      case 'both':
        return 'Pass either --root or --draft, not both, since a draft names its own roots.'
      case 'no-files':
        return 'Pass the files whose imports to show. To show the coupling between the chunks of a draft instead, pass --draft in place of --root.'
    }
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const table = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number>>
) => {
  const cells = [header, ...Array.map(rows, Array.map(globalThis.String))]
  const widths = Array.map(header, (_, column) =>
    pipe(
      cells,
      Array.map((row) => row[column]?.length ?? 0),
      Array.reduce(0, (a, b) => Number.max(a, b))
    )
  )
  return Array.map(cells, (row) =>
    pipe(
      row,
      Array.map((cell, column) =>
        column === header.length - 1
          ? cell
          : String.padStart(widths[column] ?? 0)(cell)
      ),
      Array.join('  '),
      (line) => `  ${line}`
    )
  )
}

const neighbors = Effect.fnUntraced(function* (
  resolved: Scope.Scope,
  files: ReadonlyArray<string>,
  label: (file: string) => string
) {
  const found = yield* Effect.forEach(files, (file) =>
    Imports.neighbors(resolved, file)
  )
  yield* Console.log(
    pipe(
      found,
      Array.map(({ file, imports, dependents }) =>
        Array.join(
          [
            label(file),
            ...Array.map(imports, (to) => `  imports      ${label(to)}`),
            ...Array.map(dependents, (from) => `  imported by  ${label(from)}`),
            ...(Array.isReadonlyArrayNonEmpty(imports) ||
            Array.isReadonlyArrayNonEmpty(dependents)
              ? []
              : ['  imports no file in scope and no file in scope imports it']),
          ],
          '\n'
        )
      ),
      Array.join('\n\n')
    )
  )
})

const imports = Command.make(
  'imports',
  {
    files: Argument.File('file', { mustExist: true }).pipe(
      Argument.variadic(),
      Argument.withDescription(
        'File in scope whose imports and dependents to show'
      )
    ),
    roots: Flag.Directory('root', { mustExist: true }).pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        'Directory whose files are in scope, such as a package, as for `atlas scope`. Repeat it for several roots'
      )
    ),
    draftPath: Flag.File('draft', { mustExist: true }).pipe(
      Flag.optional,
      Flag.withDescription(
        'Draft map whose roots make up the scope and whose chunks label the files. Without files, show the coupling between its chunks'
      )
    ),
  },
  Effect.fnUntraced(function* ({ files, roots, draftPath }) {
    const repository = yield* Repository.Repository
    const paths = Array.map(files, repository.relative)
    if (Option.isNone(draftPath)) {
      if (!Array.isReadonlyArrayNonEmpty(roots)) {
        return yield* new ImportsUsage({ reason: 'no-scope' })
      }
      if (!Array.isReadonlyArrayNonEmpty(paths)) {
        return yield* new ImportsUsage({ reason: 'no-files' })
      }
      const resolved = yield* Scope.resolve(
        Array.map(roots, repository.relative)
      )
      return yield* neighbors(resolved, paths, (file) => file)
    }
    if (Array.isReadonlyArrayNonEmpty(roots)) {
      return yield* new ImportsUsage({ reason: 'both' })
    }

    const draft = yield* Check.read(draftPath.value, 'imports')
    const resolved = yield* Scope.resolve(draft.roots)
    if (Array.isReadonlyArrayNonEmpty(paths)) {
      const chunks = Imports.chunkOf(draft.chunks)
      return yield* neighbors(
        resolved,
        paths,
        (file) => `${file}  in ${chunks.get(file) ?? 'no chunk'}`
      )
    }

    const { between, chunks, unassigned, repeated } = Imports.coupling(
      resolved,
      draft
    )
    yield* Console.log(
      Array.join(
        [
          'Imports between chunks, counted as imports between their files, with the ones the other way after a plus:',
          ...(Array.isReadonlyArrayNonEmpty(between)
            ? table(
                ['imports', 'chunks'],
                Array.map(between, (pair) =>
                  pair.back > 0
                    ? [
                        `${pair.imports} + ${pair.back}`,
                        `${pair.from} <-> ${pair.to}`,
                      ]
                    : [pair.imports, `${pair.from} -> ${pair.to}`]
                )
              )
            : ['  none']),
          '',
          'Chunks with their files in scope, their imports inside, out to and in from other chunks, and the parts their files split into with no imports between parts:',
          ...table(
            ['files', 'inside', 'out', 'in', 'parts', 'chunk'],
            Array.map(chunks, (chunk) => [
              chunk.files,
              chunk.inside,
              chunk.out,
              chunk.in,
              chunk.parts.length,
              chunk.chunk,
            ])
          ),
          ...pipe(
            chunks,
            Array.filter((chunk) => chunk.parts.length > 1),
            Array.flatMap((chunk) =>
              Array.flatMap(chunk.parts, (part, index) => [
                '',
                `${chunk.chunk} part ${index + 1}:`,
                ...Array.map(part, (file) => `  ${file}`),
              ])
            )
          ),
        ],
        '\n'
      )
    )
    if (repeated > 0) {
      yield* Console.error(
        `${repeated === 1 ? 'A file is' : `${repeated} files are`} in more than one chunk and counts only toward the last chunk that lists it. Run \`atlas check ${draftPath.value}\` to list them.`
      )
    }
    if (unassigned > 0) {
      yield* Console.error(
        `${unassigned === 1 ? 'A file' : `${unassigned} files`} in scope ${unassigned === 1 ? 'is' : 'are'} in no chunk, so ${unassigned === 1 ? 'its' : 'their'} imports are left out. Run \`atlas check ${draftPath.value}\` to list them.`
      )
    }
  })
).pipe(
  Command.withDescription(
    'Show the imports and dependents of files within the scope. With --draft and no files, show the coupling between the chunks of the draft instead'
  ),
  Command.provide(Repository.layer)
)

const line = (change: Changes.Change) => {
  const stat = Option.match({
    onNone: () => 'binary',
    onSome: ({ added, deleted }: Repository.Stat) => `+${added} -${deleted}`,
  })
  switch (change.kind) {
    case 'added':
      return `  added    ${change.path}  ${change.lines} ${change.lines === 1 ? 'line' : 'lines'}`
    case 'changed':
      return `  changed  ${change.path}  ${stat(change.stat)}`
    case 'renamed':
      return `  renamed  ${change.path}  from ${change.from}  ${stat(change.stat)}`
    case 'removed':
      return `  removed  ${change.path}  ${change.deleted ? 'deleted' : 'no longer in scope'}`
  }
}

const changes = Command.make(
  'changes',
  {},
  Effect.fnUntraced(function* () {
    const { artifact, changes: found } = yield* Changes.run()
    const commit = Artifact.short(artifact.commit)
    const [assigned, added] = Array.partition(found, (change) =>
      change.kind === 'added' ? Result.fail(change) : Result.succeed(change)
    )
    const byChunk = Array.groupBy(assigned, (change) => change.chunk)
    const blocks = [
      ...Array.flatMap(Artifact.chunks(artifact.chunks), (chunk) => {
        const ofChunk = byChunk[chunk.id]
        return ofChunk === undefined
          ? []
          : [[chunk.id, ...Array.map(ofChunk, line)]]
      }),
      ...(Array.isArrayNonEmpty(added)
        ? [['In no chunk', ...Array.map(added, line)]]
        : []),
    ]
    if (Array.isArrayNonEmpty(blocks)) {
      yield* Console.log(
        Array.join(Array.map(blocks, Array.join('\n')), '\n\n')
      )
    }
    const kinds = pipe(
      ['added', 'changed', 'renamed', 'removed'] as const,
      Array.flatMap((kind) => {
        const n = Array.countBy(found, (change) => change.kind === kind)
        return n > 0 ? [`${n} ${kind}`] : []
      }),
      Array.join(', ')
    )
    yield* Console.error(
      Array.isArrayNonEmpty(found)
        ? `${found.length === 1 ? 'A file' : `${found.length} files`} in the scope of ${Array.join(artifact.roots, ', ')} differ from the map at ${commit}: ${kinds}, in ${Record.size(byChunk) === 1 ? 'a chunk' : `${Record.size(byChunk)} chunks`}. Show the changes of a file with \`git diff ${commit} -- <file>\`.`
        : `No file in the scope of ${Array.join(artifact.roots, ', ')} differs from the map at ${commit}.`
    )
  })
).pipe(
  Command.withDescription(
    'List the files in scope that were added, changed, renamed or removed since the commit of the map in .atlas/map.json, by the chunk they are in'
  ),
  Command.provide(Repository.layer)
)

const draft = Command.make(
  'draft',
  {},
  Effect.fnUntraced(function* () {
    const artifact = yield* Store.get()
    const encoded = yield* Schema.encodeEffect(Artifact.Draft)({
      roots: artifact.roots,
      chunks: Artifact.mapFiles(artifact.chunks, Struct.omit(['lines'])),
      events: [],
    }).pipe(Effect.orDie)
    yield* Console.log(JSON.stringify(encoded, null, 2))
  })
).pipe(
  Command.withDescription(
    'Print the map in .atlas/map.json as a draft without events, to start an update from'
  ),
  Command.provide(Repository.layer)
)

const serve = Command.make(
  'serve',
  {
    artifact: Argument.File('artifact', { mustExist: true }).pipe(
      Argument.optional,
      Argument.withDescription(
        'Map to show, by default the .atlas/map.json of the current repository'
      )
    ),
    port: Flag.Int('port').pipe(
      Flag.withDefault(0),
      Flag.withDescription('Port to serve on, by default any free port')
    ),
    open: Flag.Boolean('open').pipe(
      Flag.withDefault(true),
      Flag.withDescription(
        'Open the viewer in the browser. Pass --no-open to only print its URL'
      )
    ),
  },
  Effect.fnUntraced(function* ({ artifact, port, open }) {
    return yield* Serve.run({
      artifact: Option.isSome(artifact) ? artifact.value : yield* Serve.find(),
      port,
      open,
    })
  })
).pipe(
  Command.withDescription(
    'Show a map in the viewer, served on localhost until you stop it with Ctrl+C'
  )
)

export const cli = Command.make('atlas').pipe(
  Command.withDescription('Map the complexity of a codebase'),
  Command.withSubcommands([
    schema,
    scope,
    imports,
    changes,
    draft,
    check,
    serve,
  ])
)
