import type * as Artifact from 'atlas/artifact'
import * as Atlas from 'atlas/artifact'
import { Array, Number } from 'effect'
import type { ReactNode } from 'react'

import * as Tier from '#/tier.ts'

type Node = Artifact.Artifact['chunks'][number]

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

const Swatch = ({ tier }: { readonly tier: Tier.Tier }) => (
  <span
    className="inline-block size-3 shrink-0 rounded-sm"
    style={{ backgroundColor: Tier.color[tier] }}
  />
)

export const Legend = () => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
    {Array.map(Tier.all, (tier) => (
      <li key={tier} className="flex items-center gap-1.5">
        <Swatch tier={tier} />
        {tier} {Tier.label[tier]}
      </li>
    ))}
  </ul>
)

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export const Details = ({
  artifact,
  node,
}: {
  readonly artifact: Artifact.Artifact
  readonly node: Node | undefined
}) => {
  if (node === undefined) {
    const chunks = Atlas.chunks(artifact.chunks)
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">
          {Array.join(artifact.roots, ', ')}
        </h2>
        <p className="text-sm text-stone-600">
          {count(chunks.length, 'chunk')} with{' '}
          {Number.sumAll(Array.map(artifact.chunks, Atlas.lines))} lines at
          commit{' '}
          <code className="font-mono">{artifact.commit.slice(0, 12)}</code>.
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
            Group of {count(Atlas.chunks(node.children).length, 'chunk')} with{' '}
            {Atlas.lines(node)} lines
          </p>
        </div>
        <p>{node.summary}</p>
      </div>
    )
  }

  const essential = node.essential
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{node.name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-stone-600">
          <Swatch tier={node.tier} />
          Tier {node.tier}, {Tier.label[node.tier]}, {Atlas.lines(node)} lines
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
