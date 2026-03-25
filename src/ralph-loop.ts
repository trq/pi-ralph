import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { getModel, getProviders } from "@mariozechner/pi-ai";
import type { KnownProvider } from "@mariozechner/pi-ai";
import { formatBlockedSummary, loadPlanQueue, resolvePlanPath } from "./plan-queue";

type CliOptions = {
  cwd: string;
  iterations: number;
  promptPath: string;
  planPath?: string;
  model?: string;
  thinkingLevel?: string;
  showThinking: boolean;
};

type AgentEvent = {
  type: string;
  [key: string]: unknown;
};

const defaultPromptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts/ralph-loop.md");
const execFileAsync = promisify(execFile);

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    cwd: process.cwd(),
    iterations: 10,
    promptPath: defaultPromptPath,
    showThinking: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--cwd") {
      opts.cwd = path.resolve(argv[++i] ?? opts.cwd);
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      opts.cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }
    if (arg === "--iterations" || arg === "-n") {
      opts.iterations = Number.parseInt(argv[++i] ?? "10", 10);
      continue;
    }
    if (arg.startsWith("--iterations=")) {
      opts.iterations = Number.parseInt(arg.slice("--iterations=".length), 10);
      continue;
    }
    if (arg === "--prompt") {
      opts.promptPath = path.resolve(argv[++i] ?? opts.promptPath);
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      opts.promptPath = path.resolve(arg.slice("--prompt=".length));
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
    if (arg === "--model") {
      opts.model = argv[++i];
      continue;
    }
    if (arg.startsWith("--model=")) {
      opts.model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--thinking") {
      opts.thinkingLevel = argv[++i];
      continue;
    }
    if (arg.startsWith("--thinking=")) {
      opts.thinkingLevel = arg.slice("--thinking=".length);
      continue;
    }
    if (arg === "--show-thinking") {
      opts.showThinking = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  if (!Number.isFinite(opts.iterations) || opts.iterations < 1) {
    throw new Error(`Invalid iteration count: ${opts.iterations}`);
  }

  return opts;
}

function printHelpAndExit(): never {
  console.log(`pi-ralph

Usage:
  pi-ralph [--cwd <dir>] [--iterations <n>] [--prompt <file>] [--plan <file>] [--model <id>] [--thinking <level>] [--show-thinking]

Options:
  --cwd <dir>           Working directory for the feature repo (default: current dir)
  --iterations <n>      Maximum Ralph iterations (default: 10)
  --prompt <file>       Prompt file to use (default: Ralph's built-in prompts/ralph-loop.md)
  --plan <file>         Plan markdown file (default: auto-detect docs/prds/*_plan.md)
  --model <id>          Override model
  --thinking <level>    Override thinking level
  --show-thinking       Stream thinking deltas to stdout
  -h, --help            Show help

Behavior:
  - Creates one git commit per iteration (allow-empty) in --cwd repository
  - Requires a clean working tree at loop start and before each iteration
`);
  process.exit(0);
}

async function readPrompt(promptPath: string): Promise<string> {
  const prompt = await fs.readFile(promptPath, "utf8");
  return prompt.trim();
}

async function ensureProjectFiles(planPath: string): Promise<void> {
  try {
    await fs.access(planPath);
  } catch {
    throw new Error(`Missing required plan file: ${planPath}`);
  }

  const planContent = await fs.readFile(planPath, "utf8");

  if (!/^##\s+Ralph Progress Log\s*$/im.test(planContent)) {
    throw new Error(
      `Plan file ${planPath} is missing required section: \"## Ralph Progress Log\". Add it to the plan before running Ralph.`,
    );
  }
}

function writeLine(text = ""): void {
  process.stdout.write(text + "\n");
}

function writeProgress(text: string): void {
  process.stdout.write(text);
}

function isCompleteMarker(text: string): boolean {
  return text.includes("<promise>COMPLETE</promise>");
}

function isKnownProvider(provider: string): provider is KnownProvider {
  return getProviders().includes(provider as KnownProvider);
}

function resolveModelFromArg(modelArg?: string) {
  if (!modelArg) return undefined;
  const [provider, ...rest] = modelArg.split("/");
  const id = rest.join("/");
  if (!provider || !id) {
    throw new Error(`Invalid --model value \"${modelArg}\". Use provider/model-id (e.g. anthropic/claude-sonnet-4).`);
  }
  if (!isKnownProvider(provider)) {
    throw new Error(`Unknown model provider: ${provider}`);
  }
  const model = getModel(provider, id as never);
  if (!model) {
    throw new Error(`Model not found: ${modelArg}`);
  }
  return model;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function assertGitRepo(cwd: string): Promise<void> {
  const output = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (output !== "true") {
    throw new Error(`${cwd} is not a git repository.`);
  }
}

async function assertWorkingTreeClean(cwd: string): Promise<void> {
  const status = await runGit(cwd, ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error(
      "Working tree is not clean. Commit or stash existing changes before running Ralph so each iteration commit is isolated.",
    );
  }
}

function summarizeAgentOutput(assistantText: string): string {
  const lines = assistantText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "(no agent summary captured)";
  }

  const summary = lines.slice(-8).join(" ").replace(/\s+/g, " ").trim();
  if (summary.length <= 600) {
    return summary;
  }

  return `${summary.slice(0, 597)}...`;
}

async function commitIteration(opts: {
  cwd: string;
  iteration: number;
  targetStoryId: string;
  targetStoryTitle: string;
  storyStatusAfter: string;
  planPath: string;
  assistantText: string;
}): Promise<void> {
  const { cwd, iteration, targetStoryId, targetStoryTitle, storyStatusAfter, planPath, assistantText } = opts;

  await runGit(cwd, ["add", "-A"]);

  const subject = `ralph(${targetStoryId}): ${storyStatusAfter} - ${targetStoryTitle}`;
  const summary = summarizeAgentOutput(assistantText);
  const body = [
    `Iteration: ${iteration}`,
    `Plan: ${planPath}`,
    `Story: ${targetStoryId}`,
    `Status: ${storyStatusAfter}`,
    "",
    `Summary: ${summary}`,
  ].join("\n");

  await runGit(cwd, ["commit", "--allow-empty", "-m", subject, "-m", body]);
}

function buildIterationPrompt(basePrompt: string, planPath: string, targetStory: string): string {
  return `${basePrompt}

Runtime context:
- Plan file: ${planPath}
- Use the \"## Ralph Queue\" table as source of truth for story status.
- Story statuses: todo, in_progress, blocked, done.
- \`blocked_by\` is a comma-separated list of story ids that must be done first.
- Focus only on this target story this iteration: ${targetStory}
- Use the \"## Ralph Progress Log\" section in the plan for iteration notes.
- When a story is complete, set its status to \`done\` in the Ralph Queue table and append learnings to the Ralph Progress Log section.
- If a story is partially complete, keep status as \`in_progress\` and append clear progress/blockers to the Ralph Progress Log section.`;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const prompt = await readPrompt(opts.promptPath);
  const planPath = await resolvePlanPath(opts.cwd, opts.planPath);
  await ensureProjectFiles(planPath);
  await assertGitRepo(opts.cwd);
  await assertWorkingTreeClean(opts.cwd);
  const selectedModel = resolveModelFromArg(opts.model);

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const settingsManager = SettingsManager.create(opts.cwd);

  if (opts.thinkingLevel) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (settingsManager as any).applyOverrides?.({ thinkingLevel: opts.thinkingLevel });
  }

  writeLine(`Ralph loop starting in ${opts.cwd}`);
  writeLine(`Prompt: ${opts.promptPath}`);
  writeLine(`Plan: ${planPath}`);
  writeLine(`Iterations: ${opts.iterations}`);
  if (opts.model) writeLine(`Model: ${opts.model}`);
  if (opts.thinkingLevel) writeLine(`Thinking: ${opts.thinkingLevel}`);

  for (let iteration = 1; iteration <= opts.iterations; iteration += 1) {
    await assertWorkingTreeClean(opts.cwd);
    const queueBefore = await loadPlanQueue(planPath);

    if (queueBefore.allDone) {
      writeLine("");
      writeLine("Ralph completed all tasks (all stories are done in the plan queue).");
      return 0;
    }

    if (queueBefore.runnableStories.length === 0) {
      writeLine("");
      writeLine("No runnable stories remain. Remaining stories are blocked.");
      writeLine(formatBlockedSummary(queueBefore));
      return 1;
    }

    writeLine("");
    writeLine("===============================================================");
    writeLine(`  Ralph iteration ${iteration} of ${opts.iterations}`);
    writeLine("===============================================================");

    const targetStory = queueBefore.runnableStories[0]!;
    writeLine(
      `Target story: ${targetStory.id} (priority ${targetStory.priority}) - ${targetStory.title}${
        targetStory.blockedBy.length > 0 ? ` [blocked_by: ${targetStory.blockedBy.join(",")}]` : ""
      }`,
    );

    const sessionManager = SessionManager.inMemory();
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel as never } : {}),
    });

    let assistantText = "";

    const unsubscribe = session.subscribe((event: AgentEvent) => {
      if (event.type === "message_update") {
        const assistantMessageEvent = event.assistantMessageEvent as { type: string; delta?: string };
        if (assistantMessageEvent.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
          assistantText += assistantMessageEvent.delta;
          writeProgress(assistantMessageEvent.delta);
          return;
        }
        if (
          opts.showThinking &&
          assistantMessageEvent.type === "thinking_delta" &&
          typeof assistantMessageEvent.delta === "string"
        ) {
          writeProgress(assistantMessageEvent.delta);
        }
        return;
      }

      if (event.type === "tool_execution_start") {
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        writeLine(`\n[tool:start] ${toolName}`);
        return;
      }

      if (event.type === "tool_execution_end") {
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        const status = event.isError ? "error" : "ok";
        writeLine(`\n[tool:end] ${toolName} (${status})`);
        return;
      }

      if (event.type === "agent_start") {
        writeLine("[agent] started");
        return;
      }

      if (event.type === "agent_end") {
        writeLine("\n[agent] finished");
      }
    });

    try {
      await session.prompt(buildIterationPrompt(prompt, planPath, targetStory.id));
    } finally {
      unsubscribe();
      session.dispose();
    }

    const queueAfter = await loadPlanQueue(planPath);
    const targetAfter = queueAfter.stories.find((story) => story.id === targetStory.id);
    const statusAfter = targetAfter?.status ?? "unknown";

    await commitIteration({
      cwd: opts.cwd,
      iteration,
      targetStoryId: targetStory.id,
      targetStoryTitle: targetStory.title,
      storyStatusAfter: statusAfter,
      planPath,
      assistantText,
    });
    writeLine(`Committed iteration ${iteration} as git commit (story ${targetStory.id}, status ${statusAfter}).`);

    if (queueAfter.allDone) {
      writeLine("");
      writeLine("Ralph completed all tasks.");
      return 0;
    }

    if (isCompleteMarker(assistantText)) {
      writeLine("");
      writeLine("Received COMPLETE marker, but queue still has unfinished stories. Continuing.");
    }

    writeLine(`Iteration ${iteration} complete; continuing.`);
  }

  writeLine("");
  writeLine(`Ralph reached max iterations (${opts.iterations}) without completing all tasks.`);
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("Ralph loop failed:");
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
