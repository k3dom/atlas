# atlas

A living map of a codebase's complexity. Claude Code explores the code through a
skill and writes the map as a JSON artifact into the repository it maps, and a
viewer shows the map as a treemap of semantic chunks, sized by lines and colored
by complexity tier.

```
packages/
  oxfmt/     shared oxfmt config
  oxlint/    shared oxlint config
  tsconfig/  shared TypeScript config
  vitest/    shared Vitest config
```

## Tooling

- Nix dev shell (`nix develop`, or direnv with `use flake`), pnpm workspaces and
  Turborepo.
- Common scripts: `format`, `lint` (includes type checking), `build`, `test`,
  `check`.
- `lint` and `check` run oxlint with type-aware rules through tsrs, which uses a
  lot of CPU and memory. Run it once when you have finished your changes, not
  after each edit.
- Issues live as GitHub issues in `k3dom/atlas`, managed via the `gh` CLI.
