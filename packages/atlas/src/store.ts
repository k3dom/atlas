import { Array, Effect, FileSystem, Option, Schema } from 'effect'
import { CliError } from 'effect/cli'

import * as Artifact from '#/artifact.ts'
import * as Repository from '#/repository.ts'

export const path = '.atlas/map.json'

export class MapMissing extends Schema.TaggedError<MapMissing>()(
  'MapMissing',
  {}
) {
  override get message(): string {
    return `There is no map at ${path}. Build one with the map skill first.`
  }
}

export class MapInvalid extends Schema.TaggedError<MapInvalid>()('MapInvalid', {
  problems: Schema.NonEmptyArray(Schema.String),
}) {
  override get message(): string {
    return Array.join(
      [
        `${path} isn't a valid atlas map:`,
        ...Array.map(this.problems, (problem) => `- ${problem}`),
        `Restore it with \`git checkout -- ${path}\`, or delete it to build a new map.`,
      ],
      '\n'
    )
  }
}

export class CommitMissing extends Schema.TaggedError<CommitMissing>()(
  'CommitMissing',
  { commit: Schema.String }
) {
  override get message(): string {
    return `The map in ${path} describes the commit ${this.commit}, which this clone doesn't have, so atlas can't tell what changed since. Fetch it with \`git fetch origin ${this.commit}\`, or delete the map to build a new one.`
  }
}

export class MapError extends Schema.TaggedError<MapError>()('MapError', {
  reason: Schema.Union([MapMissing, MapInvalid, CommitMissing]),
}) {
  override get message(): string {
    return this.reason.message
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const ArtifactJson = Schema.fromJsonString(Artifact.Artifact)

export const find = Effect.fn('Store.find')(function* () {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem
  const file = repository.absolute(path)
  if (!(yield* fs.exists(file).pipe(Effect.orDie))) {
    return Option.none()
  }
  const text = yield* fs.readFileString(file).pipe(Effect.orDie)
  return yield* Schema.decodeUnknownEffect(ArtifactJson)(text, {
    errors: 'all',
  }).pipe(
    Effect.asSome,
    Effect.catchTag(
      'SchemaError',
      (error) =>
        new MapError({
          reason: new MapInvalid({ problems: Artifact.problems(error.issue) }),
        })
    )
  )
})

export const get = Effect.fn('Store.get')(function* () {
  const found = yield* find()
  if (Option.isNone(found)) {
    return yield* new MapError({ reason: new MapMissing() })
  }
  return found.value
})

export const write = Effect.fn('Store.write')(function* (
  artifact: Artifact.Artifact
) {
  const repository = yield* Repository.Repository
  const fs = yield* FileSystem.FileSystem
  const encoded = yield* Schema.encodeEffect(Artifact.Artifact)(artifact).pipe(
    Effect.orDie
  )
  yield* fs
    .makeDirectory(repository.absolute('.atlas'), { recursive: true })
    .pipe(Effect.orDie)
  yield* fs
    .writeFileString(
      repository.absolute(path),
      `${JSON.stringify(encoded, null, 2)}\n`
    )
    .pipe(Effect.orDie)
})
