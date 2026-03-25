# Project Instructions

This repository contains a Pi-harness version of the AFK (Away From Keyboard) autonomous coding loop.

## Conventions
- Keep the loop controller simple and observable.
- Stream assistant text and tool progress to stdout as it happens.
- Each iteration should use a fresh Pi session.
- Treat the plan markdown `## AFK Loop Queue` table as the source of truth for story completion.
- Prefer small, independently completable stories.

## Runtime expectations
- The loop should be usable from the terminal.
- Use local files for persistence (plan markdown with queue/progress log, git history).
- AFK creates one git commit per iteration; keep commit behavior deterministic.
- If you change the prompt, keep the completion marker `<promise>COMPLETE</promise>`.
