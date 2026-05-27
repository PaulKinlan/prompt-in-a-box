import { runAgentLoop } from 'agent-do';
import { tool, generateObject } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import * as fs from 'fs';
import * as path from 'path';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Error: GEMINI_API_KEY environment variable is not set.");
  console.error("Please set it using: export GEMINI_API_KEY=your_key");
  process.exit(1);
}

const google = createGoogleGenerativeAI({ apiKey });
const model = google('gemini-3.1-pro-preview');

// ─── Local File System Tools ───────────────────────────────────────

const fileRead = tool({
  description: 'Read the content of a local file relative to the project root.',
  inputSchema: z.object({
    filePath: z.string().describe('Path to the file relative to project root (e.g., "manifest.json")'),
  }),
  execute: async ({ filePath }) => {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

const fileWrite = tool({
  description: 'Write content to a local file relative to the project root. Parent directories will be created if needed.',
  inputSchema: z.object({
    filePath: z.string().describe('Path to the file relative to project root (e.g., "examples/my-demo/prompt.md")'),
    content: z.string().describe('The content to write to the file.'),
  }),
  execute: async ({ filePath, content }) => {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      return { ok: true, path: fullPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

const tools = {
  file_read: fileRead,
  file_write: fileWrite,
};

// ─── Main ──────────────────────────────────────────────────────────

async function getStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
  });
}

async function main() {
  let initialPrompt = process.argv[2];
  if (!initialPrompt && !process.stdin.isTTY) {
    initialPrompt = await getStdin();
  }

  if (!initialPrompt) {
    console.error("Error: Please provide an initial prompt description.");
    console.error("Usage: npm run create \"Your prompt idea here\" or pipe to it.");
    process.exit(1);
  }

  console.log(`Analyzing idea: "${initialPrompt}"...`);

  const extensionMetadataSchema = z.object({
    name: z.string().describe('A concise, catchy, and professional name for the Chrome Extension (e.g., "Tab Summarizer", "Auto Form Filler")'),
    description: z.string().describe('A clear, 1-2 sentence description of what the extension does.'),
    permissions: z.array(z.string()).describe('A list of standard Chrome Extension permissions required for this extension (e.g., "activeTab", "storage", "alarms", "scripting", "contextMenus", "tabs", "<all_urls>")'),
  });

  let metadata;
  try {
    const { object } = await generateObject({
      model,
      schema: extensionMetadataSchema,
      prompt: `Analyze this Chrome Extension idea and infer a professional extension name, a clear description, and any appropriate Chrome Extension permissions needed to implement it.
Idea: "${initialPrompt}"`,
    });
    metadata = object;
  } catch (err) {
    console.warn("Warning: Could not infer extension metadata automatically.", err);
    metadata = {
      name: "Prompt in a Box Demo",
      description: initialPrompt,
      permissions: ["activeTab", "storage", "alarms"]
    };
  }

  console.log(`\nInferred Extension Metadata:`);
  console.log(`  Name:        ${metadata.name}`);
  console.log(`  Description: ${metadata.description}`);
  console.log(`  Permissions: ${metadata.permissions.join(', ') || 'none'}\n`);

  console.log(`Creating demo for: "${metadata.name}"`);

  const systemPrompt = `
You are an expert Chrome Extension developer and prompt engineer.
Your task is to create a new demo folder in the \`examples/\` directory based on the user's description.

Workflow:
1.  **Plan**: Use the \`file_read\` tool to read the main \`manifest.json\` and \`prompt.md\` in the project root to understand the project structure, permissions, and style.
2.  **Generate**: Design the new demo. You need to produce:
    *   \`prompt.md\`: The core logic instructions for the agent running in the extension. It should be thorough, cover edge cases, and follow the style of the reference prompt.
    *   \`README.md\`: A summary of the demo (Trigger, Required permissions, Writes, Side effects).
    *   \`manifest.json\`: A suggested manifest for this specific demo indicating required permissions.
3.  **Write**: Use the \`file_write\` tool to create the files in a new directory under \`examples/\` (use a URL-safe slug derived from the demo title).

You MUST use the tools to read the references and write the output files. Do not just output the file contents in your chat response. Cover edge cases for the project in the generated prompt.

When you are done writing all files, provide a brief summary of what you created.
`;

  try {
    const result = await runAgentLoop(
      {
        id: 'create-demo-agent',
        name: 'Create Demo Agent',
        model,
        systemPrompt,
        tools,
        maxIterations: 15, // Allow enough steps for planning, reading, and writing
        usage: { enabled: true },
      },
      `Create a new demo using the following inferred metadata:
Name: "${metadata.name}"
Description: "${metadata.description}"
Required Permissions: [${metadata.permissions.map(p => `"${p}"`).join(', ')}]

Please create this demo in a folder slug matching the extension name.`,
    );

    console.log("\nAgent Output:");
    console.log(result.text);

    if (result.usage) {
      console.log(`\nTokens used: Input ${result.usage.totalInputTokens}, Output ${result.usage.totalOutputTokens}`);
    }

  } catch (err) {
    console.error("Error running agent loop:", err);
  }
}

main().catch(console.error);
