import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { Command } from 'effect/cli'

import * as Cli from '#/cli.ts'
import PackageJson from '#package.json' with { type: 'json' }

Cli.cli.pipe(
  Command.run({ version: PackageJson.version }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
