import type * as Artifact from 'atlas/artifact'
import * as Atlas from 'atlas/artifact'
import { Array, Option, pipe, Result, Schema } from 'effect'
import { useState, type ChangeEvent, type DragEvent } from 'react'

import { Details, Legend } from '#/details.tsx'
import { Treemap } from '#/treemap.tsx'

const ArtifactJson = Schema.fromJsonString(Atlas.Artifact)

export const decode = (text: string) =>
  Result.mapError(
    Schema.decodeUnknownResult(ArtifactJson)(text, { errors: 'all' }),
    (error) => Atlas.problems(error.issue)
  )

const Problems = ({
  name,
  problems,
}: {
  readonly name: string
  readonly problems: ReadonlyArray<string>
}) => (
  <main className="flex flex-1 items-start justify-center overflow-y-auto p-8">
    <div
      role="alert"
      className="flex max-w-2xl flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-red-950"
    >
      <p className="font-medium">
        Couldn't open {name}, since it isn't a valid atlas map:
      </p>
      <ul className="list-disc pl-5 font-mono text-sm">
        {Array.map(problems, (problem, index) => (
          <li key={index}>{problem}</li>
        ))}
      </ul>
      <p className="text-sm">
        Open the <code className="font-mono">.atlas/map.json</code> that{' '}
        <code className="font-mono">atlas check</code> writes, or run{' '}
        <code className="font-mono">atlas check</code> again to rewrite it.
      </p>
    </div>
  </main>
)

const Viewer = ({ artifact }: { readonly artifact: Artifact.Artifact }) => {
  const [selected, setSelected] = useState<string>()
  return (
    <main className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        <Treemap
          artifact={artifact}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <aside className="w-96 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-5">
        <Details
          artifact={artifact}
          node={pipe(
            Atlas.nodes(artifact.chunks),
            Array.findFirst((node) => node.id === selected),
            Option.getOrUndefined
          )}
        />
      </aside>
    </main>
  )
}

export const App = () => {
  const [loaded, setLoaded] = useState<{
    readonly name: string
    readonly result: ReturnType<typeof decode>
  }>()

  const open = async (file: File | undefined) => {
    if (file !== undefined) {
      setLoaded({ name: file.name, result: decode(await file.text()) })
    }
  }

  return (
    <div
      className="flex h-screen flex-col bg-stone-50 text-stone-900"
      onDragOver={(event: DragEvent) => event.preventDefault()}
      onDrop={(event: DragEvent) => {
        event.preventDefault()
        void open(event.dataTransfer.files[0])
      }}
    >
      <header className="flex items-center gap-6 border-b border-stone-200 px-4 py-2">
        <h1 className="font-semibold">atlas</h1>
        {loaded !== undefined && Result.isSuccess(loaded.result) && <Legend />}
        <label className="ml-auto cursor-pointer rounded-md border border-stone-300 bg-white px-3 py-1 text-sm hover:bg-stone-100 has-focus-visible:outline-2 has-focus-visible:outline-blue-600">
          Open map
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void open(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }}
          />
        </label>
      </header>
      {loaded === undefined ? (
        <main className="flex flex-1 items-center justify-center p-8 text-stone-600">
          <p>
            Open a map, such as the{' '}
            <code className="font-mono">.atlas/map.json</code> that{' '}
            <code className="font-mono">atlas check</code> writes, or drop it
            here.
          </p>
        </main>
      ) : Result.isFailure(loaded.result) ? (
        <Problems name={loaded.name} problems={loaded.result.failure} />
      ) : (
        <Viewer
          key={`${loaded.name}@${loaded.result.success.commit}`}
          artifact={loaded.result.success}
        />
      )}
    </div>
  )
}
