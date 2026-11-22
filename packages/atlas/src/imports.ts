import {
  Array,
  Effect,
  Graph,
  Order,
  pipe,
  Predicate,
  Record,
  Schema,
} from 'effect'
import { CliError } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Scope from '#/scope.ts'

export class FileError extends Schema.TaggedError<FileError>()('FileError', {
  file: Schema.String,
  roots: Schema.NonEmptyArray(Schema.String),
  reason: Schema.Literals(['outside', 'generated']),
}) {
  override get message(): string {
    const roots = Array.join(this.roots, ' ')
    return this.reason === 'generated'
      ? `${this.file} is generated, so the scope of ${Array.join(this.roots, ', ')} leaves it and its imports out. Pass a file that \`atlas scope ${roots}\` lists.`
      : `${this.file} is not in the scope of ${Array.join(this.roots, ', ')}. Pass a file that \`atlas scope ${roots}\` lists.`
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

export const neighbors = Effect.fnUntraced(function* (
  scope: Scope.Scope,
  file: string
) {
  if (!Array.some(scope.files, (inScope) => inScope.path === file)) {
    return yield* new FileError({
      file,
      roots: scope.roots,
      reason: Array.contains(scope.generated, file) ? 'generated' : 'outside',
    })
  }
  return {
    file,
    imports: pipe(
      scope.imports,
      Array.filter((edge) => edge.from === file),
      Array.map((edge) => edge.to),
      Array.sort(Order.String)
    ),
    dependents: pipe(
      scope.imports,
      Array.filter((edge) => edge.to === file),
      Array.map((edge) => edge.from),
      Array.sort(Order.String)
    ),
  }
})

export const chunkOf = (draft: Artifact.Draft) =>
  new Map(
    Array.flatMap(Artifact.chunks(draft.chunks), (chunk) =>
      Array.map(chunk.files, (file) => [file.path, chunk.id] as const)
    )
  )

export const coupling = (scope: Scope.Scope, draft: Artifact.Draft) => {
  const chunks = chunkOf(draft)
  const links = Array.flatMapNullishOr(scope.imports, (edge) => {
    const from = chunks.get(edge.from)
    const to = chunks.get(edge.to)
    return Predicate.isUndefined(from) || Predicate.isUndefined(to)
      ? undefined
      : { from, to, edge }
  })
  const inside = Array.filter(links, (link) => link.from === link.to)
  const across = Array.filter(links, (link) => link.from !== link.to)
  const inScope = new Set(Array.map(scope.files, (file) => file.path))

  return {
    between: pipe(
      across,
      Array.groupBy((link) =>
        Array.join(Array.sort([link.from, link.to], Order.String), ' ')
      ),
      Record.values,
      Array.map((group) => {
        const { from, to } = group[0]
        const one = Order.min(Order.String)(from, to)
        const other = Order.max(Order.String)(from, to)
        const forward = Array.filter(group, (link) => link.from === one).length
        const backward = group.length - forward
        return forward >= backward
          ? { from: one, to: other, imports: forward, back: backward }
          : { from: other, to: one, imports: backward, back: forward }
      }),
      Array.sortBy(
        Order.mapInput(
          Order.flip(Order.Number),
          (pair) => pair.imports + pair.back
        ),
        Order.mapInput(Order.String, (pair) => pair.from),
        Order.mapInput(Order.String, (pair) => pair.to)
      )
    ),
    chunks: Array.map(Artifact.chunks(draft.chunks), (chunk) => {
      const files = pipe(
        chunk.files,
        Array.map((file) => file.path),
        Array.filter((file) => inScope.has(file))
      )
      const own = pipe(
        inside,
        Array.filter((link) => link.from === chunk.id),
        Array.map((link) => link.edge)
      )
      const graph = Graph.directed<string, undefined>((mutable) => {
        const index = new Map(
          Array.map(files, (file) => [file, Graph.addNode(mutable, file)])
        )
        for (const edge of own) {
          const from = index.get(edge.from)
          const to = index.get(edge.to)
          if (Predicate.isNotUndefined(from) && Predicate.isNotUndefined(to)) {
            Graph.addEdge(mutable, from, to, undefined)
          }
        }
      })
      return {
        chunk: chunk.id,
        files: files.length,
        inside: own.length,
        out: Array.filter(across, (link) => link.from === chunk.id).length,
        in: Array.filter(across, (link) => link.to === chunk.id).length,
        parts: pipe(
          Graph.weaklyConnectedComponents(graph),
          Array.map((part) =>
            pipe(
              part,
              Array.map((index) => Graph.getNode(graph, index)),
              Array.getSomes,
              Array.sort(Order.String)
            )
          ),
          Array.sortBy(
            Order.mapInput(Order.flip(Order.Number), (part) => part.length),
            Order.mapInput(Order.String, (part) => part[0] ?? '')
          )
        ),
      }
    }),
    unassigned: Array.filter(scope.files, (file) => !chunks.has(file.path))
      .length,
  }
}
