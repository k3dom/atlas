import type * as Artifact from 'atlas/artifact'

export type Tier = Artifact.Chunk<unknown>['tier']

export const all: ReadonlyArray<Tier> = [1, 2, 3, 4]

export const label: Record<Tier, string> = {
  1: 'Straightforward',
  2: 'Ordinary',
  3: 'Intricate',
  4: 'Hardest',
}

export const color: Record<Tier, string> = {
  1: '#86b6ef',
  2: '#3987e5',
  3: '#1c5cab',
  4: '#0d366b',
}

export const ink: Record<Tier, string> = {
  1: '#1c1917',
  2: '#ffffff',
  3: '#ffffff',
  4: '#ffffff',
}
