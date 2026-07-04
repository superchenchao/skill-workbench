# Skill Workbench Rules

This repository contains the public Skill Workbench implementation and a small example Skill source pool.

## Operating Rules

- Treat `skills/` as the canonical public Skill source pool.
- Regenerate `skills-index.json` and `dashboard.html` after adding, removing, or renaming Skills.
- Do not commit local runtime directories, caches, backups, credentials, browser profiles, or machine-specific output.
- Do not run remote GitHub update detection on dashboard page load. Page load should read `_manifests/update-status.json` if it exists; only explicit sync/update actions should refresh remote repos.

## Tooling

- Use `node scripts/skill-workbench.mjs rebuild-source` to refresh the global source index and dashboard.
- Use `node scripts/skill-workbench.mjs serve` to open the local dashboard service when GitHub update buttons need to work.
- Use `node scripts/skill-workbench.mjs init-project <projectDir>` to create a project-level Skill workspace.
- Use `node scripts/skill-workbench.mjs enable <projectDir> <skill...>` to enable Skills for a project.
- Use `node scripts/skill-workbench.mjs disable <projectDir> <skill...>` to remove project Skill links.
- Use `node scripts/skill-workbench.mjs check <projectDir>` before claiming a project Skill workspace is healthy.

## Verification

Before committing, run:

```bash
node scripts/skill-workbench.mjs rebuild-source
node --test tests/skill-workbench.test.mjs
git diff --check
```
