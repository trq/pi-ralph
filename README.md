# Pi AFK Loop (Away From Keyboard)

An AFK-style autonomous coding loop implemented with the **Pi harness SDK**.

It repeatedly creates a **fresh Pi session** (clean context each iteration), asks the agent to complete one unfinished plan story, and streams live progress to stdout.

## What it does

Per iteration:
1. Starts a new in-memory Pi session (fresh context)
2. Runs the AFK prompt (`prompts/afk-loop.md`)
3. Streams assistant output to stdout as tokens arrive
4. Streams tool progress (plain logs or Pi TUI renderer)
5. Creates a git commit for the iteration (`--allow-empty`)
6. Stops early when all plan stories are `done`

Persistent memory between iterations is your repo state (`git`, plan markdown with queue + progress log).

## Requirements

- Node 20+
- Pi-compatible auth configured (API key env var or `~/.pi/agent/auth.json`)
- Feature repo with:
  - a plan markdown file (auto-detected from `docs/prds/*_plan.md`, or passed via `--plan`)
  - `## AFK Loop Queue` and `## AFK Loop Progress Log` sections in that plan
  - a clean git working tree before starting the loop

## AFK plan format

Your selected plan markdown must include a `## AFK Loop Queue` section with a Markdown table.

Required columns:

- `id`
- `priority` (integer; lower means earlier)
- `status` (`todo`, `in_progress`, `blocked`, `done`)
- `title`

Optional columns:

- `blocked_by` (comma-separated story ids that must be `done` first)

Example:

```md
## AFK Loop Queue

| id | priority | status | title | blocked_by |
|---|---:|---|---|---|
| S1 | 1 | todo | Contract Baseline Slice | - |
| S2 | 2 | todo | Failure Semantics Slice | S1 |
| S3 | 3 | todo | Deterministic Normalization Slice | S1 |
| S4 | 4 | todo | API Guardrail + Readiness Slice | S2,S3 |

## AFK Loop Progress Log

- 2026-03-25T00:00:00.000Z Initialized.
```

## Install

```bash
npm install
```

## Run

```bash
npm run start -- --cwd /path/to/feature-repo --iterations 10
```

By default AFK uses its built-in prompt at `prompts/afk-loop.md` (resolved from the install location), so `--prompt` is optional.

AFK commits once per iteration by default. Commit format is `afk(<story-id>): <status> - <title>`, with a short body that includes iteration metadata and an agent-written summary of what was done.

Optional:

```bash
npm run start -- \
  --cwd /path/to/feature-repo \
  --plan docs/prds/my-feature_plan.md \
  --iterations 20 \
  --model anthropic/claude-sonnet-4 \
  --thinking medium \
  --show-thinking
```

AFK uses a non-interactive Pi-style TUI renderer when running in a TTY, and falls back to plain streaming logs in non-interactive environments.

## Plan lint

Validate that a plan has a parseable `## AFK Queue` with valid dependencies:

```bash
npm run plan-lint -- --cwd /path/to/feature-repo --plan docs/prds/my-feature_plan.md
```

JSON summary output:

```bash
npm run plan-lint -- --cwd /path/to/feature-repo --json
```

## Run AFK from anywhere

Use the wrapper script and symlink it into your PATH:

```bash
ln -sf /path/to/afk-loop/afk-pi.sh ~/bin/afk
chmod +x ~/bin/afk
```

Then run from any directory:

```bash
afk --cwd /path/to/feature-repo --iterations 10
afk plan-lint --cwd /path/to/feature-repo
```

The wrapper resolves symlinks to the real AFK install directory, so it no longer depends on your current working directory.

## Files

- `src/afk-loop.ts` - loop controller using Pi SDK
- `src/plan-queue.ts` - plan queue parser and validation
- `src/plan-lint.ts` - queue lint command
- `prompts/afk-loop.md` - per-iteration instructions for the agent
- `AGENTS.md` - project conventions

## Notes

- Each iteration is intentionally isolated (fresh context), matching the AFK pattern.
- Progress is visible in real time on stdout.
- Completion marker remains: `<promise>COMPLETE</promise>`.
