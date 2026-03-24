# Pi Ralph Loop

A Ralph-style autonomous coding loop implemented with the **Pi harness SDK**.

It repeatedly creates a **fresh Pi session** (clean context each iteration), asks the agent to complete one unfinished PRD story, and streams live progress to stdout.

## What it does

Per iteration:
1. Starts a new in-memory Pi session (fresh context)
2. Runs the Ralph prompt (`prompts/ralph-loop.md`)
3. Streams assistant output to stdout as tokens arrive
4. Streams tool lifecycle events (`tool:start`, `tool:end`)
5. Stops early when the agent outputs `<promise>COMPLETE</promise>`

Persistent memory between iterations is your repo state (`git`, `prd.json`, `progress.txt`).

## Requirements

- Node 20+
- Pi-compatible auth configured (API key env var or `~/.pi/agent/auth.json`)
- Feature repo with:
  - `prd.json`
  - `progress.txt` (auto-created if missing)

## Install

```bash
npm install
```

## Run

```bash
npm run start -- --cwd /path/to/feature-repo --iterations 10
```

Optional:

```bash
npm run start -- \
  --cwd /path/to/feature-repo \
  --iterations 20 \
  --model anthropic/claude-sonnet-4 \
  --thinking medium \
  --show-thinking
```

## Files

- `src/ralph-loop.ts` - loop controller using Pi SDK
- `prompts/ralph-loop.md` - per-iteration instructions for the agent
- `AGENTS.md` - project conventions

## Notes

- Each iteration is intentionally isolated (fresh context), matching the Ralph pattern.
- Progress is visible in real time on stdout.
- Completion is signaled by exact marker: `<promise>COMPLETE</promise>`.
