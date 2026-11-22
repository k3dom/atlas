import {
  Array,
  Context,
  Effect,
  Layer,
  Number,
  Option,
  Path,
  pipe,
  Schema,
  Stream,
  String,
} from 'effect'
import { CliError } from 'effect/cli'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export class NotInstalled extends Schema.TaggedError<NotInstalled>()(
  'NotInstalled',
  { cause: Schema.Defect() }
) {
  override get message(): string {
    return 'atlas runs git, which is not on the PATH. Install git and run atlas again.'
  }
}

export class NotRepository extends Schema.TaggedError<NotRepository>()(
  'NotRepository',
  { cwd: Schema.String }
) {
  override get message(): string {
    return `${this.cwd} is not inside a git repository. Run atlas from the repository you map.`
  }
}

export class NoCommits extends Schema.TaggedError<NoCommits>()(
  'NoCommits',
  {}
) {
  override get message(): string {
    return 'The repository has no commits yet. Commit the code you map and run atlas again.'
  }
}

export class CommandFailed extends Schema.TaggedError<CommandFailed>()(
  'CommandFailed',
  { args: Schema.Array(Schema.String), stderr: Schema.String }
) {
  override get message(): string {
    return `\`git ${Array.join(this.args, ' ')}\` failed: ${this.stderr}`
  }
}

export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  reason: Schema.Union([NotInstalled, NotRepository, NoCommits, CommandFailed]),
}) {
  override get message(): string {
    return this.reason.message
  }

  override get [CliError.userMessage](): string {
    return this.message
  }
}

export interface Diff {
  readonly path: string
  readonly from?: string | undefined
  readonly added: number | undefined
  readonly deleted: number | undefined
}

const count = (value: string | undefined) =>
  Option.getOrUndefined(Number.parse(value ?? ''))

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
            return yield* new GitError({
              reason: new CommandFailed({ args, stderr: String.trim(stderr) }),
            })
          }
          return stdout
        },
        Effect.scoped,
        Effect.catchTag(
          'PlatformError',
          (cause) => new GitError({ reason: new NotInstalled({ cause }) })
        )
      )

      const root = yield* git(cwd, 'rev-parse', '--show-toplevel').pipe(
        Effect.map(String.trim),
        Effect.catchReason(
          'GitError',
          'CommandFailed',
          () => new GitError({ reason: new NotRepository({ cwd }) })
        )
      )
      const run = (...args: ReadonlyArray<string>) => git(root, ...args)

      const relative = (file: string) => path.relative(root, path.resolve(file))

      const absolute = (file: string) => path.join(root, file)

      const tracked = Effect.fn('Repository.tracked')(function* () {
        const deleted = new Set(
          paths(yield* run('ls-files', '-z', '--deleted'))
        )
        return new Set(
          Array.filter(
            paths(yield* run('ls-files', '-z')),
            (file) => !deleted.has(file)
          )
        )
      })

      const head = Effect.fn('Repository.head')(function* () {
        return yield* run('rev-parse', '--verify', 'HEAD').pipe(
          Effect.map(String.trim),
          Effect.catchReason(
            'GitError',
            'CommandFailed',
            () => new GitError({ reason: new NoCommits() })
          )
        )
      })

      const changed = Effect.fn('Repository.changed')(function* (
        files: ReadonlyArray<string>
      ) {
        return paths(
          yield* run('diff', 'HEAD', '--name-only', '-z', '--', ...files)
        )
      })

      const diff = Effect.fn('Repository.diff')(function* (commit: string) {
        const fields = paths(
          yield* run('diff', '--numstat', '-z', '-M', commit, '--')
        )
        const files: Array<Diff> = []
        for (let index = 0; index < fields.length; index++) {
          const parts = String.split(fields[index] ?? '', '\t')
          const counts = { added: count(parts[0]), deleted: count(parts[1]) }
          const file = parts[2] ?? ''
          if (String.isEmpty(file)) {
            files.push({
              from: fields[index + 1],
              path: fields[index + 2] ?? '',
              ...counts,
            })
            index += 2
          } else {
            files.push({ path: file, ...counts })
          }
        }
        return files
      })

      return { root, relative, absolute, tracked, head, changed, diff }
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
