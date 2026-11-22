# atlas

A living map of a codebase's complexity, built by an agent and shown as a
treemap.

The `map` skill has Claude Code split the code in a scope, such as a package and
the workspace code it imports, into semantic chunks and rate each from tier 1
(straightforward) to tier 4 (the hardest in the codebase). The `atlas` CLI lists
the files in scope, shows how they import each other and checks the agent's
draft, then writes the map to `.atlas/map.json` in the mapped repository with
line counts and the commit it measured itself.

Once the repository has a map, the skill updates it from the files that changed
since its commit. Chunks the changes don't touch keep their ids and ratings, and
every split, merge, rename or other change to a chunk is recorded as an event
with its reason in the history of the map.

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
`/atlas:map packages/club-cli`. Run `/atlas:map` again later to update it.

The CLI also works on its own:

```sh
atlas scope packages/club-cli   # files in scope with their line counts
atlas imports --root packages/club-cli packages/club-cli/src/main.ts
                                # imports and dependents of a file in scope
atlas imports --draft draft.json
                                # coupling between the chunks of a draft
atlas changes                   # files changed since the commit of the map
atlas draft > draft.json        # the map as a draft to update
atlas schema                    # JSON Schema of a draft
atlas check draft.json          # validate a draft and its events against the
                                # map and write .atlas/map.json
atlas serve                     # show .atlas/map.json in the viewer
atlas serve map.json            # show another map in the viewer
```

## Development

```sh
nix develop
pnpm install
pnpm check
```
