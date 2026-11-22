import {
  Array,
  Effect,
  Number,
  pipe,
  Predicate,
  Schema,
  SchemaIssue,
  String,
} from 'effect'

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
  readonly tier: Tier
  readonly rationale: string
  readonly essential: number
  readonly files: Array.NonEmptyReadonlyArray<File>
}

export type Node<File> = Group<File> | Chunk<File>

export const Tier = Schema.Literals([1, 2, 3, 4])

export type Tier = typeof Tier.Type

const Text = Schema.String.check(Schema.isNonEmpty(), Schema.isTrimmed())

const Id = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
).annotate({
  description:
    'Kebab-case id, unique across the map, that stays the same when the map is updated',
})

const tree = <File>(File: Schema.Codec<File>) => {
  const common = {
    id: Id,
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
      tier: Tier.annotate({
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

const reason = Text.annotate({
  description:
    'Why the map changed, such as the change to the code that called for it',
})

const Several = Schema.Array(Id).check(Schema.isMinLength(2), Schema.isUnique())

export const Event = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('add'), chunk: Id, reason }).annotate({
    description: 'A new chunk, such as one for new code',
  }),
  Schema.Struct({ kind: Schema.Literal('remove'), chunk: Id, reason }).annotate(
    { description: 'A chunk that is gone, such as one whose code was deleted' }
  ),
  Schema.Struct({
    kind: Schema.Literal('rename'),
    from: Id,
    to: Id,
    reason,
  }).annotate({ description: 'A chunk that goes on under a new id' }),
  Schema.Struct({
    kind: Schema.Literal('split'),
    from: Id,
    into: Several,
    reason,
  }).annotate({
    description:
      'A chunk whose files now make up several chunks. One of them can keep its id',
  }),
  Schema.Struct({
    kind: Schema.Literal('merge'),
    from: Several,
    into: Id,
    reason,
  }).annotate({
    description:
      'Chunks whose files now make up one chunk, which can keep the id of one of them',
  }),
  Schema.Struct({ kind: Schema.Literal('revise'), chunk: Id, reason }).annotate(
    {
      description:
        'A chunk that keeps its id and changes otherwise, such as in its files or its tier',
    }
  ),
])
  .annotate({ identifier: 'Event' })
  .pipe(Schema.toTaggedUnion('kind'))

export type Event = typeof Event.Type

export const sources: (event: Event) => ReadonlyArray<string> = Event.match({
  add: () => [],
  remove: (event) => [event.chunk],
  revise: (event) => [event.chunk],
  rename: (event) => [event.from],
  split: (event) => [event.from],
  merge: (event) => event.from,
})

export const targets: (event: Event) => ReadonlyArray<string> = Event.match({
  add: (event) => [event.chunk],
  remove: () => [],
  revise: (event) => [event.chunk],
  rename: (event) => [event.to],
  split: (event) => event.into,
  merge: (event) => [event.into],
})

export const Draft = Schema.Struct({
  roots,
  chunks: Schema.NonEmptyArray(tree(Schema.Struct({ path: Path, mixed }))),
  events: Schema.Array(Event)
    .annotate({
      description:
        'How the chunks differ from those of the map in .atlas/map.json, so that every change to the map has a reason. A chunk takes part in at most one event. A new map has none',
    })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).annotate({
  title: 'Draft of an atlas map',
  description:
    'A map of the complexity of a codebase. Every file in scope is in exactly one chunk.',
})

export type Draft = typeof Draft.Type

const MeasuredFile = Schema.Struct({
  path: Path,
  lines: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mixed,
})

export type MeasuredFile = typeof MeasuredFile.Type

const Commit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u))

export const Artifact = Schema.Struct({
  version: Schema.Literal(1),
  commit: Commit.annotate({
    description: 'SHA of the commit the map describes',
  }),
  roots,
  chunks: Schema.NonEmptyArray(tree(MeasuredFile)),
  history: Schema.Array(
    Schema.Struct({
      commit: Commit.annotate({
        description: 'SHA of the commit the update brought the map to',
      }),
      events: Schema.NonEmptyArray(Event),
    })
  )
    .annotate({
      description:
        'The updates of the map that changed its chunks, oldest first, with their events',
    })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).annotate({
  title: 'Atlas map',
  description:
    'A map of the complexity of a codebase, with line counts measured at its commit.',
})

export type Artifact = typeof Artifact.Type

export const short = (commit: string) => String.slice(0, 12)(commit)

export const nodes = <File>(
  forest: ReadonlyArray<Node<File>>
): Array<Node<File>> =>
  Array.flatMap(forest, (node) =>
    node.kind === 'group' ? [node, ...nodes(node.children)] : [node]
  )

export const chunks = <File>(
  forest: ReadonlyArray<Node<File>>
): Array<Chunk<File>> =>
  Array.filter(nodes(forest), (node) => node.kind === 'chunk')

export const mapFiles = <A, B>(
  forest: Array.NonEmptyReadonlyArray<Node<A>>,
  f: (file: A) => B
): Array.NonEmptyArray<Node<B>> =>
  Array.map(forest, (node): Node<B> =>
    node.kind === 'group'
      ? { ...node, children: mapFiles(node.children, f) }
      : { ...node, files: Array.map(node.files, f) }
  )

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

export const problems = (
  issue: SchemaIssue.Issue
): Array.NonEmptyReadonlyArray<string> =>
  pipe(
    SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues,
    Array.map(({ path = [], message }) =>
      Array.isReadonlyArrayNonEmpty(path)
        ? `${formatPath(path)}: ${message}`
        : message
    ),
    (messages) =>
      Array.isArrayNonEmpty(messages)
        ? messages
        : [String.trim(SchemaIssue.makeFormatterDefault()(issue))]
  )

export const lines = (node: Node<{ readonly lines: number }>): number =>
  node.kind === 'group'
    ? Number.sumAll(Array.map(node.children, lines))
    : Number.sumAll(Array.map(node.files, (file) => file.lines))
