---
name: map
description:
  Use this skill when the user asks to map, chart or rate the complexity of a
  codebase or a part of it, such as a package and the workspace code it imports,
  or to build an atlas map in `.atlas/map.json`. Explores the code and its
  imports with the atlas CLI, groups its files into semantic chunks, scores each
  chunk against a four-tier rubric and validates the map with `atlas check`. Do
  not use for source maps, dependency graphs or architecture diagrams.
---

# Map

You build an atlas map: a JSON artifact that splits the code in a scope into
semantic chunks and rates how hard each is. A viewer shows it as a treemap sized
by lines and colored by tier, so people can see where a codebase is hard before
they change it.

## Setup

Run `atlas --version`. If the command is missing, tell the user to install the
CLI with `nix profile install git+ssh://git@github.com/k3dom/atlas` and stop.

Work from the root of the repository you map. The scope is a set of root
directories, usually packages. Take them from the request, and ask when the
request names no part of the codebase.

## Explore

`atlas scope <root>...` prints every file in scope with its line count. The
scope is the source files of the roots plus every workspace file they import,
directly or transitively, without tests, tool configs and generated files.
Stderr gives the totals, then lists any generated files it left out and any
imports it could not follow, such as unresolved ones or ones that point to files
git doesn't track. The files behind those imports are missing from the map, so
name them in your report. Read the files before you chunk them: names and paths
alone don't show where the hard parts are.

`atlas imports --root <root> <file>...` lists which files in scope each file
imports and which import it, so you can see what a file works with before you
choose its chunk. Imports through generated files, such as a route tree, count
as imports of the files they import. Repeat `--root` once per root, such as
`--root packages/app --root packages/web`.

For a scope of more than about a hundred files, delegate reading to subagents,
one per part of about ten to fifteen thousand lines. Cut parts along the chunks
you expect, so a subagent sees all layers of the concepts it maps: per package
or per feature area, and in a package laid out by technical kind, such as
`domain/`, `services/` and `tables/`, per group of related concepts across those
directories rather than per directory. Give each subagent:

- the whole `atlas scope` output, so it can rate its part against the rest
- the file list of its part, each file of which goes into exactly one of its
  chunks
- the `atlas imports` command with the roots
- this skill's Chunk and Rate sections, and the conventions that make the parts
  fit together: the id prefix of each package and which groups to use
- a path to write its proposal to, as JSON that maps each package to an array
  of nodes as `atlas schema` describes them, so merging is mechanical

Ask it to report its hardest chunks and their rationale, the cuts and tiers it
was unsure of, and the files whose main concern lies in another part. Merge the
proposals under one group per package and move those files to the chunk of their
concern. Then even out the tiers across parts by reading the tier 3 and 4
rationales of all parts side by side: subagents rate their own part, so the same
kind of difficulty can land in different tiers.

## Chunk

A chunk is a semantic unit that people work on together, such as a feature, a
mechanism or a layer of one domain concept, usually a few files and a few
hundred to two thousand lines. Group chunks into groups, such as one per package
and one per area inside a large package. Groups can nest and sit next to chunks,
so nest only where it helps people find their way. Every file in scope goes into
exactly one chunk. A file that holds several concerns goes to the chunk of its
main concern with `"mixed": true`.

Give each node an id in kebab case that names its concept, such as
`club-messages-delivery`, so it stays the same when the map is updated.

Use the imports to cluster: files that import each other a lot usually belong
together, and a file imported from many chunks is often a shared layer of its
own. Once the draft is written, `atlas imports --draft .atlas/draft.json` shows
the coupling between its chunks and the parts each chunk falls into, and with
files after it, labels their imports and dependents with their chunks.
Reconsider chunks that import each other in both directions or many times
compared with the imports inside them, since they may be one concept, and chunks
that split into several parts, since they may be several. Keep a chunk as it is
when its files belong together for a reason imports don't show, such as
endpoints of one feature that a router wires up.

## Rate

Rate the tier relative to the rest of the scope, not against an absolute scale,
so the map shows where this codebase is hard. In a scope of a dozen chunks or
more, expect some in every tier, though a part of a larger scope may have none
in tier 1 or tier 4. Rate by what it takes to change the code safely, not by its
size: a large chunk of plain screens or of data, such as seed records or tables
of names, is tier 1 or 2.

1. Straightforward. Declarations, wiring and thin glue, such as schemas without
   logic or commands that call one endpoint. A newcomer changes it safely.
2. Ordinary logic. Branching and state that stay local, so reading the chunk is
   enough to change it. Tooling that no other chunk depends on, such as
   benchmark harnesses, usually stays here even when it leans on the internals
   of outside tools.
3. Intricate. Invariants that span files or services, many interacting cases,
   concurrency or a protocol to follow. Changing it safely takes knowledge of
   other parts.
4. The hardest code in the scope, where bugs hide and few people change things
   with confidence, such as the access rules every query filters by or a
   pipeline whose stages run concurrently in several processes. Keep this for
   the few hardest chunks, about a tenth of a large scope.

The rationale names what makes the chunk as hard as its tier, such as "Renders
email for three clients and has to keep their quirks apart", not that it is
"complex". `essential` is the percent of that complexity the problem itself
demands, such as domain rules and protocols. The rest is accidental, such as
framework workarounds, indirection and duplication.

## Write and check

`atlas schema` prints the JSON Schema of the draft. Write the draft to
`.atlas/draft.json`, review its coupling as described under Chunk, and run
`atlas check .atlas/draft.json`. Line counts and the commit are measured by
`check`, so the draft holds neither.

Fix what `check` reports and run it again until it writes `.atlas/map.json`,
then delete the draft. If the code changed since you ran `atlas scope`, `check`
reports the difference as missing files and files in no chunk, so run
`atlas scope` again to see what changed.

You are done when `check` has written the map. Report its path, the summary
`check` printed, the tier 4 chunks with their rationale and the imports `scope`
could not follow. Leave committing the map to the user.
