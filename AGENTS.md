# Project Instructions

This repository contains a Pi-harness version of the Ralph autonomous coding loop.

## Conventions
- Keep the loop controller simple and observable.
- Stream assistant text and tool progress to stdout as it happens.
- Each iteration should use a fresh Pi session.
- Treat `prd.json` as the source of truth for story completion.
- Prefer small, independently completable stories.

## Runtime expectations
- The loop should be usable from the terminal.
- Use local files for persistence (`prd.json`, `progress.txt`, git history).
- If you change the prompt, keep the completion marker `<promise>COMPLETE</promise>`.
