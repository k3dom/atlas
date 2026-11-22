# atlas

A living map of a codebase's complexity, built by an agent and shown as a
treemap.

The `map` skill has Claude Code split the code in a scope, such as a package and
the workspace code it imports, into semantic chunks and rate each from tier 1
(straightforward) to tier 4 (the hardest in the codebase). The `atlas` CLI lists
the files in scope and checks the agent's draft, then writes the map to
`.atlas/map.json` in the mapped repository with line counts and the commit it
measured itself.

## Install

Install the CLI with Nix:

```sh
nix profile install git+ssh://git@github.com/k3dom/atlas
```

Add the plugin with the skill in Claude Code:

```text
/plugin marketplace add k3dom/atlas
/plugin install atlas@k3dom
```

## Use

In the repository to map, ask Claude Code for a map, such as
`/atlas:map packages/club-cli`.

The CLI also works on its own:

```sh
atlas scope packages/club-cli   # files in scope with their line counts
atlas schema                    # JSON Schema of a draft
atlas check draft.json          # validate a draft and write .atlas/map.json
```

## Development

```sh
nix develop
pnpm install
pnpm check
```
