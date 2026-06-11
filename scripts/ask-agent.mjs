#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const VALID_AGENTS = new Map([
  ["agd", "coordination/agd-inbox.md"],
  ["antigravity", "coordination/agd-inbox.md"],
  ["codex", "coordination/codex-inbox.md"],
]);

const [, , rawAgent, ...promptParts] = process.argv;

if (!rawAgent || promptParts.length === 0) {
  usage();
  process.exit(1);
}

const agent = rawAgent.toLowerCase();
const inbox = VALID_AGENTS.get(agent);
if (!inbox) {
  console.error(`Unknown agent "${rawAgent}". Expected one of: ${[...VALID_AGENTS.keys()].join(", ")}`);
  process.exit(1);
}

const prompt = await readPrompt(promptParts);
const coordinationDir = path.dirname(inbox);
await mkdir(coordinationDir, { recursive: true });

const promptFile = path.join(
  coordinationDir,
  `.last-${agent}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
);
await writeFile(promptFile, prompt);

const entry = [
  "",
  `## ${new Date().toISOString()}`,
  "",
  "```text",
  prompt.trim(),
  "```",
  "",
].join("\n");
await appendFile(inbox, entry);

const sendCommand = process.env.TRIPSYNC_AGENT_SEND_CMD;
if (sendCommand) {
  await sendToConfiguredCommand(sendCommand, agent, promptFile);
  console.log(`Sent prompt to ${agent} using TRIPSYNC_AGENT_SEND_CMD and recorded it in ${inbox}`);
} else {
  console.log(`Recorded prompt for ${agent} in ${inbox}`);
  console.log("Set TRIPSYNC_AGENT_SEND_CMD to also forward prompts to a live screen/tmux/cmux agent.");
}

async function readPrompt(parts) {
  if (parts.length === 1 && parts[0] === "-") {
    return readStdin();
  }
  if (parts.length === 2 && parts[0] === "--file") {
    return readFile(parts[1], "utf8");
  }
  return parts.join(" ");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function sendToConfiguredCommand(command, agentName, filePath) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        TRIPSYNC_AGENT_NAME: agentName,
        TRIPSYNC_AGENT_PROMPT_FILE: filePath,
      },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`TRIPSYNC_AGENT_SEND_CMD exited with ${code}`));
    });
    child.on("error", reject);
  });
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/ask-agent.mjs <agd|codex> \"prompt\"");
  console.error("  node scripts/ask-agent.mjs <agd|codex> --file prompt.txt");
  console.error("  echo \"prompt\" | node scripts/ask-agent.mjs <agd|codex> -");
}

