import fs from "node:fs/promises";
import path from "node:path";

export type PlanStoryStatus = "todo" | "in_progress" | "blocked" | "done";

export type PlanStory = {
  id: string;
  priority: number;
  status: PlanStoryStatus;
  title: string;
  blockedBy: string[];
};

export type PlanQueue = {
  stories: PlanStory[];
  doneIds: Set<string>;
  runnableStories: PlanStory[];
  allDone: boolean;
};

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/\s+/g, "_");
}

function parseBlockedBy(value: string): string[] {
  if (!value || value === "-") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseStatus(raw: string, storyId: string, planPath: string): PlanStoryStatus {
  const value = raw.toLowerCase();
  if (value === "todo" || value === "in_progress" || value === "blocked" || value === "done") {
    return value;
  }

  throw new Error(
    `Plan file ${planPath} has invalid status for story ${storyId}: ${raw}. Expected one of: todo, in_progress, blocked, done.`,
  );
}

export async function resolvePlanPath(cwd: string, explicitPlanPath?: string): Promise<string> {
  if (explicitPlanPath) {
    return path.resolve(cwd, explicitPlanPath);
  }

  const prdDir = path.join(cwd, "docs", "prds");
  let entries: string[] = [];

  try {
    const dirEntries = await fs.readdir(prdDir, { withFileTypes: true });
    entries = dirEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith("_plan.md"))
      .map((entry) => path.join(prdDir, entry.name));
  } catch {
    throw new Error(`Missing docs/prds directory in ${cwd}. Pass --plan <file> to specify a plan.`);
  }

  if (entries.length === 1) {
    return entries[0]!;
  }

  if (entries.length === 0) {
    throw new Error(`No *_plan.md files found in ${prdDir}. Pass --plan <file> to specify a plan.`);
  }

  throw new Error(
    `Multiple *_plan.md files found in ${prdDir}. Pass --plan <file> to choose one. Found: ${entries
      .map((entry) => path.basename(entry))
      .join(", ")}`,
  );
}

export async function loadPlanQueue(planPath: string): Promise<PlanQueue> {
  const content = await fs.readFile(planPath, "utf8");
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+Ralph Queue\s*$/i.test(line.trim()));

  if (headingIndex < 0) {
    throw new Error(`Plan file ${planPath} is missing required section: \"## Ralph Queue\".`);
  }

  const tableLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      if (tableLines.length > 0) {
        break;
      }
      continue;
    }

    if (trimmed.startsWith("## ") && tableLines.length > 0) {
      break;
    }

    if (trimmed.startsWith("|")) {
      tableLines.push(trimmed);
    }
  }

  if (tableLines.length < 3) {
    throw new Error(`Plan file ${planPath} has an invalid Ralph Queue table (need header, separator, and at least one story row).`);
  }

  const headers = parseTableRow(tableLines[0] ?? "").map(normalizeHeaderKey);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredColumns = ["id", "priority", "status", "title"];

  for (const column of requiredColumns) {
    if (!headerIndex.has(column)) {
      throw new Error(`Plan file ${planPath} Ralph Queue is missing required column: ${column}`);
    }
  }

  const stories: PlanStory[] = [];

  for (const rowLine of tableLines.slice(2)) {
    const row = parseTableRow(rowLine);
    const id = row[headerIndex.get("id") ?? -1] ?? "";
    const priorityRaw = row[headerIndex.get("priority") ?? -1] ?? "";
    const statusRaw = row[headerIndex.get("status") ?? -1] ?? "";
    const title = row[headerIndex.get("title") ?? -1] ?? "";
    const blockedByRaw = headerIndex.has("blocked_by") ? row[headerIndex.get("blocked_by") ?? -1] ?? "" : "";

    if (!id) {
      throw new Error(`Plan file ${planPath} has a Ralph Queue row with empty id.`);
    }

    const priority = Number.parseInt(priorityRaw, 10);

    if (!Number.isFinite(priority)) {
      throw new Error(`Plan file ${planPath} has invalid priority for story ${id}: ${priorityRaw}`);
    }

    if (!title) {
      throw new Error(`Plan file ${planPath} has empty title for story ${id}.`);
    }

    stories.push({
      id,
      priority,
      status: parseStatus(statusRaw, id, planPath),
      title,
      blockedBy: parseBlockedBy(blockedByRaw),
    });
  }

  const ids = new Set<string>();
  const priorities = new Set<number>();

  for (const story of stories) {
    if (ids.has(story.id)) {
      throw new Error(`Plan file ${planPath} has duplicate Ralph Queue story id: ${story.id}`);
    }
    ids.add(story.id);

    if (priorities.has(story.priority)) {
      throw new Error(`Plan file ${planPath} has duplicate Ralph Queue priority: ${story.priority}`);
    }
    priorities.add(story.priority);
  }

  for (const story of stories) {
    for (const blockedStoryId of story.blockedBy) {
      if (!ids.has(blockedStoryId)) {
        throw new Error(
          `Plan file ${planPath} story ${story.id} has blocked_by reference to unknown story id: ${blockedStoryId}`,
        );
      }
    }
  }

  const doneIds = new Set(stories.filter((story) => story.status === "done").map((story) => story.id));

  const runnableStories = stories
    .filter((story) => {
      if (story.status === "done" || story.status === "blocked") {
        return false;
      }

      return story.blockedBy.every((blockedStoryId) => doneIds.has(blockedStoryId));
    })
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  return {
    stories,
    doneIds,
    runnableStories,
    allDone: doneIds.size === stories.length,
  };
}

export function formatBlockedSummary(queue: PlanQueue): string {
  const remainingStories = queue.stories.filter((story) => story.status !== "done");
  return remainingStories
    .map((story) => {
      const missingDeps = story.blockedBy.filter((id) => !queue.doneIds.has(id));
      const reasonParts: string[] = [];

      if (story.status === "blocked") {
        reasonParts.push("status=blocked");
      }

      if (missingDeps.length > 0) {
        reasonParts.push(`waiting_on=${missingDeps.join(",")}`);
      }

      if (reasonParts.length === 0) {
        reasonParts.push("not_runnable");
      }

      return `${story.id}(${reasonParts.join(";")})`;
    })
    .join(" ");
}
