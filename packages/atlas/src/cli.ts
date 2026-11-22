import {
  Array,
  Console,
  Effect,
  JsonSchema,
  Number,
  Option,
  pipe,
  Schema,
  String,
} from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Check from '#/check.ts'
import * as Imports from '#/imports.ts'
import * as Repository from '#/repository.ts'
import * as Scope from '#/scope.ts'

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
    const { artifact, path, changed } = yield* Check.run(draft)
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
      `Wrote ${path} at ${artifact.commit}: ${nodes.length - chunks.length} groups, ${chunks.length} chunks (${tiers}), ${files.length} files and ${Number.sumAll(Array.map(files, (file) => file.lines))} lines.`
    )
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
    'Validate a draft map against its scope and write it to .atlas/map.json with measured line counts and the commit'
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
      const chunks = Imports.chunkOf(draft)
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

export const cli = Command.make('atlas').pipe(
  Command.withDescription('Map the complexity of a codebase'),
  Command.withSubcommands([schema, scope, imports, check])
)
