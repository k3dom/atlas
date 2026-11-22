import * as Artifact from 'atlas/artifact'
import { Array, Number, pipe, String } from 'effect'
import type { ReactNode } from 'react'

import * as Tier from '#/tier.ts'

const Section = ({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">
      {title}
    </h3>
    {children}
  </section>
)

const Swatch = ({ tier }: { readonly tier: Artifact.Tier }) => (
  <span
    className="inline-block size-3 shrink-0 rounded-sm"
    style={{ backgroundColor: Tier.color[tier] }}
  />
)

export const Legend = () => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
    {Array.map(Artifact.Tier.literals, (tier) => (
      <li key={tier} className="flex items-center gap-1.5">
        <Swatch tier={tier} />
        {tier} {Tier.label[tier]}
      </li>
    ))}
  </ul>
)

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export const history = (artifact: Artifact.Artifact, id: string) => {
  const found: Array<{
    readonly commit: string
    readonly event: Artifact.Event
  }> = []
  let ids: ReadonlySet<string> = new Set([id])
  for (const entry of pipe(
    artifact.history,
    Array.flatMap((update) =>
      Array.map(update.events, (event) => ({ commit: update.commit, event }))
    ),
    Array.reverse
  )) {
    const targets = Artifact.targets(entry.event)
    if (Array.some(targets, (target) => ids.has(target))) {
      found.push(entry)
      ids = new Set([
        ...Array.filter(
          Array.fromIterable(ids),
          (known) => !Array.contains(targets, known)
        ),
        ...Artifact.sources(entry.event),
      ])
    }
  }
  return found
}

const describe = (event: Artifact.Event, id: string) => {
  switch (event.kind) {
    case 'add':
      return event.chunk === id ? 'Added' : `Added as ${event.chunk}`
    case 'remove':
      return `Removed ${event.chunk}`
    case 'revise':
      return event.chunk === id ? 'Revised' : `Revised as ${event.chunk}`
    case 'rename':
      return event.to === id
        ? `Renamed from ${event.from}`
        : `Renamed from ${event.from} to ${event.to}`
    case 'split':
      return `Split from ${event.from} into ${Array.join(event.into, ', ')}`
    case 'merge':
      return `Merged ${Array.join(event.from, ', ')} into ${event.into}`
  }
}

export const Details = ({
  artifact,
  node,
}: {
  readonly artifact: Artifact.Artifact
  readonly node: Artifact.Node<Artifact.MeasuredFile> | undefined
}) => {
  if (node === undefined) {
    const chunks = Artifact.chunks(artifact.chunks)
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">
          {Array.join(artifact.roots, ', ')}
        </h2>
        <p className="text-sm text-stone-600">
          {count(chunks.length, 'chunk')} with{' '}
          {Number.sumAll(Array.map(artifact.chunks, Artifact.lines))} lines at
          commit{' '}
          <code className="font-mono">
            {String.slice(0, 12)(artifact.commit)}
          </code>
          .
        </p>
        <p className="text-sm text-stone-600">
          Select a chunk to see its details. Select a group by its header to
          zoom into it, and use the path below the map to zoom back out.
        </p>
      </div>
    )
  }

  if (node.kind === 'group') {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{node.name}</h2>
          <p className="text-sm text-stone-600">
            Group of {count(Artifact.chunks(node.children).length, 'chunk')}{' '}
            with {Artifact.lines(node)} lines
          </p>
        </div>
        <p>{node.summary}</p>
      </div>
    )
  }

  const essential = node.essential
  const events = history(artifact, node.id)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{node.name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-stone-600">
          <Swatch tier={node.tier} />
          Tier {node.tier}, {Tier.label[node.tier]}, {Artifact.lines(node)}{' '}
          lines
        </p>
      </div>
      <p>{node.summary}</p>
      <Section title="What makes it hard">
        <p>{node.rationale}</p>
      </Section>
      <Section title="Complexity">
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-sm">
          <div className="bg-blue-600" style={{ width: `${essential}%` }} />
          <div className="flex-1 bg-stone-300" />
        </div>
        <p className="flex justify-between text-sm text-stone-600">
          <span>{essential}% essential</span>
          <span>{100 - essential}% accidental</span>
        </p>
      </Section>
      {Array.isArrayNonEmpty(events) && (
        <Section title="History">
          <ol className="flex flex-col gap-3">
            {Array.map(events, ({ commit, event }, index) => (
              <li key={index} className="flex flex-col gap-0.5 text-sm">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {describe(event, node.id)}
                  </span>
                  <code className="font-mono text-xs text-stone-500">
                    {String.slice(0, 12)(commit)}
                  </code>
                </p>
                <p className="text-stone-700">{event.reason}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title={count(node.files.length, 'file')}>
        <ul className="flex flex-col gap-1 text-sm">
          {Array.map(node.files, (file) => (
            <li key={file.path} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 font-mono break-all">
                {file.path}
              </span>
              {file.mixed === true && (
                <span
                  className="rounded-sm bg-amber-100 px-1 text-xs text-amber-900"
                  title="Also holds concerns of other chunks"
                >
                  mixed
                </span>
              )}
              <span className="text-stone-500 tabular-nums">{file.lines}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
