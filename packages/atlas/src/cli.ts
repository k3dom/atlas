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
import { Argument, Command, Flag } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Check from '#/check.ts'
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

export const cli = Command.make('atlas').pipe(
  Command.withDescription('Map the complexity of a codebase'),
  Command.withSubcommands([schema, scope, check])
)
