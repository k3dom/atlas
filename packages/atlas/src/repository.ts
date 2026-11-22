import {
  Array,
  Context,
  Effect,
  Layer,
  Path,
  pipe,
  Schema,
  Stream,
  String,
} from 'effect'
import { CliError } from 'effect/cli'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  args: Schema.Array(Schema.String),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Couldn't run \`git ${Array.join(this.args, ' ')}\`: ${this.detail}`
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

const paths = (output: string) =>
  pipe(output, String.split('\0'), Array.filter(String.isNonEmpty))

export class Repository extends Context.Service<Repository>()(
  'atlas/Repository',
  {
    make: Effect.fnUntraced(function* (cwd: string) {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const path = yield* Path.Path

      const git = Effect.fnUntraced(
        function* (dir: string, ...args: ReadonlyArray<string>) {
          const handle = yield* spawner.spawn(
            ChildProcess.make('git', args, { cwd: dir })
          )
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ],
            { concurrency: 'unbounded' }
          )
          if (exitCode !== 0) {
            return yield* new GitError({ args, detail: String.trim(stderr) })
          }
          return stdout
        },
        Effect.scoped,
        (effect, _cwd, ...args) =>
          Effect.catchTag(
            effect,
            'PlatformError',
            (error) => new GitError({ args, detail: error.message })
          )
      )

      const root = String.trim(yield* git(cwd, 'rev-parse', '--show-toplevel'))
      const run = (...args: ReadonlyArray<string>) => git(root, ...args)

      const tracked = Effect.fn('Repository.tracked')(function* () {
        return new Set(paths(yield* run('ls-files', '-z')))
      })

      const head = Effect.fn('Repository.head')(function* () {
        return String.trim(yield* run('rev-parse', 'HEAD'))
      })

      const changed = Effect.fn('Repository.changed')(function* (
        files: ReadonlyArray<string>
      ) {
        return paths(
          yield* run('diff', 'HEAD', '--name-only', '-z', '--', ...files)
        )
      })

      return {
        root,
        relative: (file: string) => path.relative(root, path.resolve(file)),
        absolute: (file: string) => path.join(root, file),
        tracked,
        head,
        changed,
      }
    }),
  }
) {}

export const layer = Layer.effect(
  Repository,
  Effect.gen(function* () {
    const path = yield* Path.Path
    return yield* Repository.make(path.resolve('.'))
  })
)
