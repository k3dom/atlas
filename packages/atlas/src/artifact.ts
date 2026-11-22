import { type Array, Schema } from 'effect'

export interface Group<File> {
  readonly kind: 'group'
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly children: Array.NonEmptyReadonlyArray<Node<File>>
}

export interface Chunk<File> {
  readonly kind: 'chunk'
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly tier: 1 | 2 | 3 | 4
  readonly rationale: string
  readonly essential: number
  readonly files: Array.NonEmptyReadonlyArray<File>
}

export type Node<File> = Group<File> | Chunk<File>

const Text = Schema.String.check(Schema.isNonEmpty(), Schema.isTrimmed())

const tree = <File>(File: Schema.Codec<File>) => {
  const common = {
    id: Schema.String.check(
      Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    ).annotate({
      description:
        'Kebab-case id, unique across the map, that stays the same when the map is updated',
    }),
    name: Text.annotate({ description: 'Short name for people' }),
    summary: Text.annotate({
      description: 'One or two sentences on what the code does',
    }),
  }
  const Node: Schema.Codec<Node<File>> = Schema.Union([
    Schema.Struct({
      kind: Schema.Literal('group'),
      ...common,
      children: Schema.NonEmptyArray(Schema.suspend(() => Node)),
    }).annotate({
      description: 'Related chunks and groups, such as those of one package',
    }),
    Schema.Struct({
      kind: Schema.Literal('chunk'),
      ...common,
      tier: Schema.Literals([1, 2, 3, 4]).annotate({
        description:
          'How hard the chunk is to understand and change safely, relative to the rest of the codebase, from 1 (straightforward) to 4 (the hardest)',
      }),
      rationale: Text.annotate({
        description: 'What makes the chunk as hard as its tier says',
      }),
      essential: Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: 100 })
      ).annotate({
        description:
          'Percent of the complexity that the problem itself demands. The rest is accidental, coming from how the code solves it',
      }),
      files: Schema.NonEmptyArray(File),
    }).annotate({
      description:
        'A semantic unit of code, such as a feature or a mechanism, and the files that make it up',
    }),
  ]).annotate({ identifier: 'Node' })
  return Node
}

const Path = Schema.String.annotate({
  description: 'Path of the file relative to the repository root',
})

const mixed = Schema.optionalKey(Schema.Boolean).annotate({
  description:
    'Whether the file also holds concerns of other chunks. Every file is in exactly one chunk, so a mixed file goes to the chunk of its main concern',
})

const roots = Schema.NonEmptyArray(Schema.String).annotate({
  description:
    'Directories relative to the repository root, such as packages, whose files and the workspace files they import make up the scope',
})

export const Draft = Schema.Struct({
  roots,
  chunks: Schema.NonEmptyArray(tree(Schema.Struct({ path: Path, mixed }))),
}).annotate({
  title: 'Draft of an atlas map',
  description:
    'A map of the complexity of a codebase. Every file in scope is in exactly one chunk.',
})

export type Draft = typeof Draft.Type

export const Artifact = Schema.Struct({
  version: Schema.Literal(1),
  commit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)).annotate({
    description: 'SHA of the commit the map describes',
  }),
  roots,
  chunks: Schema.NonEmptyArray(
    tree(
      Schema.Struct({
        path: Path,
        lines: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        mixed,
      })
    )
  ),
}).annotate({
  title: 'Atlas map',
  description:
    'A map of the complexity of a codebase, with line counts measured at its commit.',
})

export type Artifact = typeof Artifact.Type
