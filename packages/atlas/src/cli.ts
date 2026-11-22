import { Array, Console, Effect, JsonSchema, Schema } from 'effect'
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

const scope = Command.make(
  'scope',
  {
    roots: Argument.String('root').pipe(
      Argument.atLeast(1),
      Argument.withDescription(
        'Directory whose files are in scope, such as a package'
      )
    ),
  },
  Effect.fnUntraced(function* ({ roots }) {
    const repository = yield* Repository.Repository
    const relative = Array.map(
      roots,
      (root) => repository.relative(root) || '.'
    )
    const { files, unresolved } = yield* Scope.resolve(relative)
    const width = globalThis.String(
      Math.max(...Array.map(files, (file) => file.lines))
    ).length
    for (const file of files) {
      yield* Console.log(
        `${globalThis.String(file.lines).padStart(width)}  ${file.path}`
      )
    }
    yield* Console.error(
      `${files.length} files with ${Array.reduce(files, 0, (sum, file) => sum + file.lines)} lines in the scope of ${Array.join(relative, ', ')}.`
    )
    if (Array.isArrayNonEmpty(unresolved)) {
      yield* Console.error(
        [
          `${unresolved.length} imports could not be resolved, so files they point to may be missing:`,
          ...Array.map(
            unresolved,
            ({ from, specifier }) => `  ${specifier} from ${from}`
          ),
        ].join('\n')
      )
    }
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
    const chunks = Check.chunksOf(artifact.chunks)
    const files = Array.flatMap(chunks, (chunk) => chunk.files)
    yield* Console.error(
      `Wrote ${path} with ${chunks.length} chunks, ${files.length} files and ${Array.reduce(files, 0, (sum, file) => sum + file.lines)} lines at ${artifact.commit}.`
    )
    if (Array.isArrayNonEmpty(changed)) {
      yield* Console.error(
        [
          `${changed.length} files in scope differ from ${artifact.commit}, so their line counts describe the working tree. Commit them and run check again for a map of a commit:`,
          ...Array.map(changed, (file) => `  ${file}`),
        ].join('\n')
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
