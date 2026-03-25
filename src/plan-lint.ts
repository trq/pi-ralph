import process from "node:process";
import { loadPlanQueue, resolvePlanPath } from "./plan-queue";

type CliOptions = {
  cwd: string;
  planPath?: string;
  asJson: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    cwd: process.cwd(),
    asJson: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--cwd") {
      opts.cwd = argv[++i] ?? opts.cwd;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      opts.cwd = arg.slice("--cwd=".length);
      continue;
    }

    if (arg === "--plan") {
      opts.planPath = argv[++i];
      continue;
    }

    if (arg.startsWith("--plan=")) {
      opts.planPath = arg.slice("--plan=".length);
      continue;
    }

    if (arg === "--json") {
      opts.asJson = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  return opts;
}

function printHelpAndExit(): never {
  console.log(`pi-afk-plan-lint

Usage:
  npm run plan-lint -- [--cwd <dir>] [--plan <file>] [--json]

Options:
  --cwd <dir>    Feature repo root (default: current dir)
  --plan <file>  Plan markdown path (default: auto-detect docs/prds/*_plan.md)
  --json         Output summary JSON
  -h, --help     Show help
`);
  process.exit(0);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const planPath = await resolvePlanPath(opts.cwd, opts.planPath);
  const queue = await loadPlanQueue(planPath);

  if (opts.asJson) {
    const payload = {
      planPath,
      totalStories: queue.stories.length,
      doneStories: queue.doneIds.size,
      runnableStories: queue.runnableStories.map((story) => story.id),
      allDone: queue.allDone,
    };
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  console.log(`Plan OK: ${planPath}`);
  console.log(`Stories: ${queue.stories.length}`);
  console.log(`Done: ${queue.doneIds.size}`);
  console.log(`Runnable: ${queue.runnableStories.map((story) => story.id).join(", ") || "none"}`);
  console.log(`All done: ${queue.allDone ? "yes" : "no"}`);

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("Plan lint failed:");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
