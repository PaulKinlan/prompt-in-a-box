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

// ─── Dynamic Tool Registry Scanner ──────────────────────────────────

function generateToolReference() {
  const toolsDir = path.join(process.cwd(), 'src/tools');
  const indexFile = path.join(toolsDir, 'index.ts');
  
  if (!fs.existsSync(indexFile)) {
    return 'No tool reference available.';
  }

  try {
    const indexContent = fs.readFileSync(indexFile, 'utf-8');
    const toolsToPermission = {};

    // 1. Parse TOOLS_BY_PERMISSION mapping inside src/tools/index.ts
    const blockRegex = /(\w+|__always__):\s*\{([\s\S]*?)\}/g;
    let match;
    while ((match = blockRegex.exec(indexContent)) !== null) {
      const permission = match[1];
      const toolsBlock = match[2];
      const toolRegex = /(\w+):\s*\w+/g;
      let toolMatch;
      while ((toolMatch = toolRegex.exec(toolsBlock)) !== null) {
        const toolName = toolMatch[1];
        toolsToPermission[toolName] = permission === '__always__' ? 'None (Always available)' : permission;
      }
    }

    // 2. Scan src/tools directory for individual tool files
    const files = fs.readdirSync(toolsDir)
      .filter(file => file.endsWith('.ts') && file !== 'index.ts' && file !== 'provider-tools.ts');

    let referenceText = '# Extension Tool Registry Reference\n\n';
    referenceText += 'Below is a comprehensive catalogue of every tool defined in `src/tools/` mapped to its corresponding Chrome permission and Zod parameter schema. When designing the system prompt (`prompt.md`) for the new extension, you **must only reference these exact tools and parameter names**.\n\n';
    referenceText += '| Tool Name | Required Permission | Description |\n';
    referenceText += '|---|---|---|\n';

    const toolDetails = [];

    for (const file of files) {
      const filePath = path.join(toolsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const kebabName = file.replace('.ts', '');
      const toolName = kebabName.replace(/-/g, '_');
      const permission = toolsToPermission[toolName] || 'None (Always available)';

      // Extract description
      const descMatch = content.match(/description:\s*['"`]([\s\S]*?)['"`]/);
      const description = descMatch ? descMatch[1].trim().replace(/\s+/g, ' ') : 'No description provided.';

      // Append row to the summary table
      referenceText += `| \`${toolName}\` | \`${permission}\` | ${description} |\n`;

      // Extract Zod inputSchema
      const schemaMatch = content.match(/inputSchema:\s*(?:z|external_exports2)\.object\(\{([\s\S]*?)\}\)/);
      let parametersStr = 'No parameters';
      if (schemaMatch) {
        parametersStr = schemaMatch[1].trim()
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join('\n    ');
      }

      toolDetails.push({
        name: toolName,
        permission,
        description,
        parameters: parametersStr
      });
    }

    referenceText += '\n### Detailed Tool Specifications\n\n';
    for (const t of toolDetails) {
      referenceText += `#### \`${t.name}\`\n`;
      referenceText += `- **Required Chrome Permission**: \`${t.permission}\`\n`;
      referenceText += `- **Description**: ${t.description}\n`;
      referenceText += `- **Zod Parameters Schema**:\n  \`\`\`typescript\n  ${t.parameters}\n  \`\`\`\n\n`;
    }

    return referenceText;
  } catch (err) {
    console.warn('Warning: Could not dynamically scan tool files for catalogue.', err.message);
    return 'No tool reference available.';
  }
}

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

  const toolReference = generateToolReference();

  const systemPrompt = `
You are an expert Chrome Extension developer and prompt engineer.
Your task is to create a new demo folder in the \`examples/\` directory based on the user's description.

${toolReference}

Workflow:
1.  **Plan**: Use the \`file_read\` tool to read the main \`manifest.json\` and \`prompt.md\` in the project root to understand the project structure, permissions, and style.
2.  **Generate**: Design the new demo. You need to produce:
    *   \`prompt.md\`: The core logic instructions for the agent running in the extension. It should be thorough, cover edge cases, and follow the style of the reference prompt.
        *IMPORTANT*: Your generated \`prompt.md\` must only utilize the exact tools listed in the Extension Tool Registry Reference above, and it must describe their usage and parameters exactly as defined. Never invent tools or parameters.
    *   \`README.md\`: A summary of the demo (Trigger, Required permissions, Writes, Side effects).
        *IMPORTANT*: The required permissions in your README must match the exact permissions mapped to the tools used in your prompt.
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
