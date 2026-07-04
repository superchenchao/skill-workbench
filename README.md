# Skill Workbench

A local-first workbench for managing, browsing, importing, and project-scoping Agent Skills.

The core idea is simple: keep Skills in one source pool, audit and browse them from a generated dashboard, then enable only the Skills a specific project actually needs.

## What It Does

- Maintains a canonical `skills/` source pool.
- Generates `skills-index.json` and `dashboard.html`.
- Imports Skills from public GitHub repositories.
- Tracks explicit GitHub source rules for updateable Skills.
- Creates project-level `.agents/skills` workspaces.
- Enables and disables project Skill links without globally enabling every Skill.

## Quick Start

Requirements:

- Node.js 18+
- Git

Generate the dashboard:

```bash
node scripts/skill-workbench.mjs rebuild-source
```

Open `dashboard.html` directly for static browsing.

Start the local service when you need import, sync, remove, or project-link actions:

```bash
node scripts/skill-workbench.mjs serve
```

Run tests:

```bash
node --test tests/skill-workbench.test.mjs
```

## Common Commands

```bash
node scripts/skill-workbench.mjs list-missing-zh
node scripts/skill-workbench.mjs init-project /path/to/project
node scripts/skill-workbench.mjs enable /path/to/project example-skill
node scripts/skill-workbench.mjs disable /path/to/project example-skill
node scripts/skill-workbench.mjs check /path/to/project
```

## Repository Layout

```text
.
├── skills/                         # Canonical Skill source pool
├── scripts/
│   └── skill-workbench.mjs          # Main CLI, dashboard, import, sync, and project-link logic
├── tests/
│   └── skill-workbench.test.mjs     # Node test suite
├── _manifests/
│   ├── source-rules.json            # Explicit GitHub source mappings
│   └── zh-descriptions.json         # Optional Chinese description cache
├── skills-index.json                # Generated public index
├── dashboard.html                   # Generated static dashboard
└── AGENTS.md                        # Repository collaboration rules
```

These local runtime directories are intentionally ignored:

```text
_backups/
_legacy/
_logs/
_repos/
_tmp/
output/
.agents/
.claude/
```

## Adding Skills

Add a Skill under `skills/<slug>/SKILL.md`, then rebuild:

```bash
node scripts/skill-workbench.mjs rebuild-source
```

If a group of Skills shares one upstream GitHub repository, add one source rule to `_manifests/source-rules.json` instead of repeating source metadata in every Skill.

## Private Source Sync

This public repository is designed to be refreshed from a private source repository by a controlled export script. The public repo should stay clean, reproducible, and free of private Skills, local caches, credentials, and machine-specific paths.

## License

MIT
