---
name: map
description:
  Use this skill when the user asks to map, chart or rate the complexity of a
  codebase or a part of it, such as a package and the workspace code it imports,
  or to build an atlas map in `.atlas/map.json`. Explores the code with the
  atlas CLI, groups its files into semantic chunks, scores each chunk against a
  four-tier rubric and validates the map with `atlas check`.
---

# Map

You build an atlas map: a JSON artifact that splits the code in a scope into
semantic chunks and rates how hard each is. A viewer shows it as a treemap sized
by lines and colored by tier, so people can see where a codebase is hard before
they change it.

## Setup

Run `atlas --version`. If the command is missing, tell the user to install the
CLI with `nix profile install github:k3dom/atlas` and stop.

Work from the root of the repository you map. The scope is a set of root
directories, usually packages. Take them from the request, and ask when the
request names no part of the codebase.

## Explore

`atlas scope <root>...` prints every file in scope with its line count. The
scope is the source files of the roots plus every workspace file they import,
directly or transitively, without tests, tool configs and generated files. The
last lines on stderr give the totals and imports it could not resolve. Read the
files before you chunk them: names and paths alone don't show where the hard
parts are.

For a scope of more than about a hundred files, delegate reading to subagents,
one per package or directory. Give each the file list of its part, this skill's
rubric below, and ask for proposed chunks with a summary, tier, rationale and
essential share each. Merge their proposals into one map so the tiers stay
relative to the whole scope.

## Chunk

A chunk is a semantic unit that people work on together, such as a feature, a
mechanism or a layer of one domain concept, usually a few files and a few
hundred to two thousand lines. Group chunks into groups, such as one per package
and one per area inside a large package. Every file in scope goes into exactly
one chunk. A file that holds several concerns goes to the chunk of its main
concern with `"mixed": true`.

Give each node an id in kebab case that names its concept, such as
`club-messages-delivery`, so it stays the same when the map is updated.

## Rate

Rate the tier relative to the rest of the scope, not against an absolute scale,
so the map shows where this codebase is hard. Expect chunks in every tier.

1. Straightforward. Declarations, wiring and thin glue, such as schemas without
   logic or commands that call one endpoint. A newcomer changes it safely.
2. Ordinary logic. Branching and state that stay local, so reading the chunk is
   enough to change it.
3. Intricate. Invariants that span files or services, many interacting cases,
   concurrency or a protocol to follow. Changing it safely takes knowledge of
   other parts.
4. The hardest code in the scope, where bugs hide and few people change things
   with confidence. Keep this for the few hardest chunks, about a tenth.

The rationale names what makes the chunk as hard as its tier, such as "Renders
email for three clients and has to keep their quirks apart", not that it is
"complex". `essential` is the percent of that complexity the problem itself
demands, such as domain rules and protocols. The rest is accidental, such as
framework workarounds, indirection and duplication.

## Write and check

`atlas schema` prints the JSON Schema of the draft. Write the draft to
`.atlas/draft.json` and run `atlas check .atlas/draft.json`. Line counts and the
commit are measured by `check`, so the draft holds neither.

`check` lists every problem, such as fields that break the schema, files in no
chunk or in two, ids used twice and paths outside the scope, with what to do
about each. Fix the draft and run it again until it writes `.atlas/map.json`.
Then delete the draft.

You are done when `check` has written the map. Report its path, the counts
`check` printed and the tier 4 chunks with their rationale. Leave committing the
map to the user.
