import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { getModel, getProviders } from "@mariozechner/pi-ai";
import type { KnownProvider } from "@mariozechner/pi-ai";

type CliOptions = {
  cwd: string;
  iterations: number;
  promptPath: string;
  model?: string;
  thinkingLevel?: string;
  showThinking: boolean;
};

type AgentEvent = {
  type: string;
  [key: string]: unknown;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    cwd: process.cwd(),
    iterations: 10,
    promptPath: path.resolve(process.cwd(), "prompts/ralph-loop.md"),
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
  pi-ralph [--cwd <dir>] [--iterations <n>] [--prompt <file>] [--model <id>] [--thinking <level>] [--show-thinking]

Options:
  --cwd <dir>           Working directory for the feature repo (default: current dir)
  --iterations <n>      Maximum Ralph iterations (default: 10)
  --prompt <file>       Prompt file to use (default: prompts/ralph-loop.md)
  --model <id>          Override model
  --thinking <level>    Override thinking level
  --show-thinking       Stream thinking deltas to stdout
  -h, --help            Show help
`);
  process.exit(0);
}

async function readPrompt(promptPath: string): Promise<string> {
  const prompt = await fs.readFile(promptPath, "utf8");
  return prompt.trim();
}

async function ensureProjectFiles(cwd: string): Promise<void> {
  const prdPath = path.join(cwd, "prd.json");
  const progressPath = path.join(cwd, "progress.txt");

  try {
    await fs.access(prdPath);
  } catch {
    throw new Error(`Missing required file: ${prdPath}`);
  }

  try {
    await fs.access(progressPath);
  } catch {
    await fs.writeFile(progressPath, "# Ralph Progress Log\nStarted: " + new Date().toISOString() + "\n---\n");
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

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const prompt = await readPrompt(opts.promptPath);
  await ensureProjectFiles(opts.cwd);
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
  writeLine(`Iterations: ${opts.iterations}`);
  if (opts.model) writeLine(`Model: ${opts.model}`);
  if (opts.thinkingLevel) writeLine(`Thinking: ${opts.thinkingLevel}`);

  for (let iteration = 1; iteration <= opts.iterations; iteration += 1) {
    writeLine("");
    writeLine("===============================================================");
    writeLine(`  Ralph iteration ${iteration} of ${opts.iterations}`);
    writeLine("===============================================================");

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
      await session.prompt(prompt);
    } finally {
      unsubscribe();
      session.dispose();
    }

    if (isCompleteMarker(assistantText)) {
      writeLine("");
      writeLine("Ralph completed all tasks.");
      return 0;
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
