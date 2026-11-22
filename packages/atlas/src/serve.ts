import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  String,
} from 'effect'
import { CliError } from 'effect/cli'
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
  HttpStaticServer,
} from 'effect/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import * as Artifact from '#/artifact.ts'
import * as Repository from '#/repository.ts'

export class NoMap extends Schema.TaggedError<NoMap>()('NoMap', {
  root: Schema.String,
}) {
  override get message(): string {
    return `${this.root} has no map at .atlas/map.json yet. Ask Claude Code for one with /atlas:map, or pass the path of a map to serve.`
  }
}

export class OutsideRepository extends Schema.TaggedError<OutsideRepository>()(
  'OutsideRepository',
  { cwd: Schema.String }
) {
  override get message(): string {
    return `${this.cwd} is not inside a git repository, so it has no map to serve. Pass the path of a map, or run atlas serve in the repository you mapped.`
  }
}

export class InvalidMap extends Schema.TaggedError<InvalidMap>()('InvalidMap', {
  artifact: Schema.String,
  problems: Schema.NonEmptyArray(Schema.String),
}) {
  override get message(): string {
    return Array.join(
      [
        `${this.artifact} isn't a valid atlas map:`,
        ...Array.map(this.problems, (problem) => `- ${problem}`),
        'Serve the .atlas/map.json that `atlas check` writes, or run `atlas check` again to rewrite it.',
      ],
      '\n'
    )
  }
}

export class NoViewer extends Schema.TaggedError<NoViewer>()('NoViewer', {
  viewer: Schema.String,
}) {
  override get message(): string {
    return `The viewer isn't built at ${this.viewer}. Run \`pnpm build\` in the atlas repository, or install atlas with Nix, which bundles the viewer.`
  }
}

export class PortInUse extends Schema.TaggedError<PortInUse>()('PortInUse', {
  port: Schema.Number,
}) {
  override get message(): string {
    return `Port ${this.port} is in use. Pass another --port, or leave it out to serve on any free port.`
  }
}

export class ViewerError extends Schema.TaggedError<ViewerError>()(
  'ViewerError',
  {
    reason: Schema.Union([
      NoMap,
      OutsideRepository,
      InvalidMap,
      NoViewer,
      PortInUse,
    ]),
  }
) {
  override get message(): string {
    return this.reason.message
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const ArtifactJson = Schema.fromJsonString(Artifact.Artifact)

export const find = Effect.fn('Serve.find')(
  function* () {
    const repository = yield* Repository.Repository
    const fs = yield* FileSystem.FileSystem
    const artifact = repository.absolute('.atlas/map.json')
    if (!(yield* fs.exists(artifact).pipe(Effect.orDie))) {
      return yield* new ViewerError({
        reason: new NoMap({ root: repository.root }),
      })
    }
    return artifact
  },
  Effect.provide(Repository.layer),
  Effect.catchReason(
    'GitError',
    'NotRepository',
    ({ cwd }) => new ViewerError({ reason: new OutsideRepository({ cwd }) })
  )
)

export const layer = (options: {
  readonly artifact: string
  readonly viewer: string
}) =>
  Layer.mergeAll(
    HttpRouter.add(
      'GET',
      '/',
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const [html, map] = yield* Effect.all([
          fs.readFileString(path.join(options.viewer, 'index.html')),
          fs.readFileString(options.artifact),
        ])
        const script = `<script id="map" type="application/json">${String.replaceAll('<', '\\u003c')(map)}</script>`
        return HttpServerResponse.html(
          html.replace('</head>', () => `${script}</head>`)
        )
      }).pipe(Effect.orDie)
    ),
    HttpStaticServer.layer({ root: options.viewer })
  )

const browse = Effect.fnUntraced(
  function* (url: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer'
          : 'xdg-open'
    const handle = yield* spawner.spawn(
      ChildProcess.make(command, [url], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      })
    )
    yield* handle.unref.pipe(Effect.asVoid)
  },
  Effect.scoped,
  (self) => Effect.ignore(self)
)

export const run = Effect.fn('Serve.run')(function* (options: {
  readonly artifact: string
  readonly port: number
  readonly open: boolean
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  yield* fs.readFileString(options.artifact).pipe(
    Effect.orDie,
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(ArtifactJson)(text, { errors: 'all' })
    ),
    Effect.catchTag(
      'SchemaError',
      (error) =>
        new ViewerError({
          reason: new InvalidMap({
            artifact: options.artifact,
            problems: Artifact.problems(error.issue),
          }),
        })
    )
  )

  const viewer = yield* Config.String('ATLAS_VIEWER').pipe(
    Config.withDefault(path.join(import.meta.dirname, '../../atlas-web/dist'))
  )
  if (!(yield* fs.exists(path.join(viewer, 'index.html')).pipe(Effect.orDie))) {
    return yield* new ViewerError({ reason: new NoViewer({ viewer }) })
  }

  const announce = Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const url = HttpServer.formatAddress(server.address)
    yield* Console.error(`Serving ${options.artifact} at ${url}`)
    if (options.open) {
      yield* browse(url)
    }
  })

  return yield* Layer.effectDiscard(announce).pipe(
    Layer.provideMerge(
      HttpRouter.serve(layer({ artifact: options.artifact, viewer }), {
        disableLogger: true,
        disableListenLog: true,
      })
    ),
    Layer.provide(
      NodeHttpServer.layer(createServer, {
        port: options.port,
        host: '127.0.0.1',
      })
    ),
    Layer.launch,
    Effect.catchTag('ServeError', (error) =>
      Schema.is(Schema.Struct({ code: Schema.Literal('EADDRINUSE') }))(
        error.cause
      )
        ? new ViewerError({ reason: new PortInUse({ port: options.port }) })
        : Effect.die(error)
    )
  )
})
