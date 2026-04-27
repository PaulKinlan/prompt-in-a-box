import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Error: GEMINI_API_KEY environment variable is not set.");
  console.error("Please set it using: export GEMINI_API_KEY=your_key");
  process.exit(1);
}

const google = createGoogleGenerativeAI({ apiKey });
const model = google('gemini-3.1-pro-preview');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  const initialPrompt = process.argv[2];
  if (!initialPrompt) {
    console.error("Error: Please provide an initial prompt description.");
    console.error("Usage: npm run create \"Your prompt idea here\"");
    process.exit(1);
  }

  console.log(`Initial idea: "${initialPrompt}"`);

  // Read references
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, 'manifest.json');
  const promptPath = path.join(rootDir, 'prompt.md');

  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const promptContent = fs.readFileSync(promptPath, 'utf-8');

  // Create backups/templates folder as requested
  const templatesDir = path.join(rootDir, 'scripts', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(templatesDir, 'manifest.json'), manifestContent);
  fs.writeFileSync(path.join(templatesDir, 'prompt.md'), promptContent);
  console.log(`Backed up current manifest.json and prompt.md to ${templatesDir}`);

  let currentDescription = initialPrompt;
  let generatedPrompt = '';
  let generatedReadme = '';
  let generatedManifest = '';

  while (true) {
    console.log("\nGenerating/Refining prompt with Gemini...");

    const systemInstruction = `
You are an expert Chrome Extension developer and prompt engineer.
You are helping design a new demo for the 'Prompt in a Box' project.
In this project, the entire logic of the extension is driven by a 'prompt.md' file.
The extension wakes up on alarms or events and executes the instructions in 'prompt.md'.

I will provide you with:
1. The current main 'manifest.json' of the project (as reference for available permissions and structure).
2. The current main 'prompt.md' (as reference for style and structure).
3. A description of the new demo prompt to create.

Your task is to generate 3 files for the new demo:
1. 'prompt.md': The core logic instructions for the agent. It should be thorough, cover edge cases, and follow the style of the reference prompt.
2. 'README.md': A summary of the demo (Trigger, Required permissions, Writes, Side effects).
3. 'manifest.json': A suggested manifest for this specific demo if it were to be run as a standalone extension or to indicate required permissions.

Return the output in a structured JSON format with keys: 'prompt', 'readme', 'manifest'.
`;

    const prompt = `
Reference Manifest:
\`\`\`json
${manifestContent}
\`\`\`

Reference Prompt:
\`\`\`markdown
${promptContent}
\`\`\`

New Demo Description: "${currentDescription}"

Generate the files.
`;

    try {
      const { text } = await generateText({
        model,
        systemInstruction,
        prompt,
      });

      // Assume the model returns JSON or we need to parse it.
      // Let's try to parse it. If it fails, we might need to adjust the prompt to ensure clean JSON.
      try {
        // Find the JSON block in the response if the model wrapped it in markdown
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        
        generatedPrompt = data.prompt;
        generatedReadme = data.readme;
        generatedManifest = typeof data.manifest === 'object' ? JSON.stringify(data.manifest, null, 2) : data.manifest;
        
        console.log("\n--- Generated prompt.md Preview ---");
        console.log(generatedPrompt.slice(0, 500) + "...\n(truncated)");
        
      } catch (parseError) {
        console.error("Failed to parse Gemini response as JSON. Raw response:");
        console.log(text);
        rl.close();
        process.exit(1);
      }

    } catch (err) {
      console.error("Error calling Gemini:", err);
      rl.close();
      process.exit(1);
    }

    const action = await ask("\nDo you want to (a)ccept, (r)efine, or (q)uit? ");
    
    if (action.toLowerCase() === 'a') {
      const slug = currentDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const outputDir = path.join(rootDir, 'examples', slug);
      
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'prompt.md'), generatedPrompt);
      fs.writeFileSync(path.join(outputDir, 'README.md'), generatedReadme);
      fs.writeFileSync(path.join(outputDir, 'manifest.json'), generatedManifest);
      
      console.log(`\nSuccess! Created demo in ${outputDir}`);
      break;
    } else if (action.toLowerCase() === 'r') {
      currentDescription = await ask("How should we refine it? ");
    } else {
      console.log("Aborted.");
      break;
    }
  }

  rl.close();
}

main().catch(console.error);
