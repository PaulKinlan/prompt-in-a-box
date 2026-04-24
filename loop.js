/**
 * Minimal provider-agnostic agent loop.
 *
 * This is a deliberately small implementation — tool-use loop,
 * nothing else. Enough to run the example prompt against Anthropic,
 * Google, or OpenAI, with BYO API key, inside an MV3 service worker.
 *
 * Why not just require agent-do? Two reasons:
 *   1. This demo is the post's point: "the prompt is the program,
 *      the harness is the runtime." Keeping the harness small +
 *      visible makes the shape legible.
 *   2. agent-do currently assumes Node-y globals + dynamic provider
 *      imports that don't play nicely in an SW + CSP sandbox. Once
 *      it ships a browser-first build, swap this out.
 *
 * Contract:
 *   runLoop({ prompt, tools, provider, model, apiKey, maxSteps }) →
 *     { text, steps, toolCalls }
 *
 * Each iteration:
 *   1. POST current message list to the provider.
 *   2. If the model returns text only, we're done.
 *   3. If the model returns tool calls, execute each, append results,
 *      repeat.
 *
 * Stops at `maxSteps` (default 8) even if the model wants to keep
 * going — SW runtime budget is finite, and a runaway loop in an MV3
 * SW is a bad time.
 */

export async function runLoop({
  prompt,
  tools,
  provider,
  model,
  apiKey,
  maxSteps = 8,
}) {
  const client = pickClient(provider);
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  let messages = [{ role: 'user', content: 'Begin your scheduled run now.' }];
  let steps = 0;
  let toolCalls = 0;
  let finalText = '';

  while (steps < maxSteps) {
    steps++;
    const res = await client.chat({
      apiKey,
      model,
      system: prompt,
      messages,
      tools,
    });

    // Collect text for the final summary.
    if (res.text) finalText = res.text;

    if (!res.toolCalls || res.toolCalls.length === 0) {
      // Model chose to stop — return whatever text it emitted.
      return { text: finalText, steps, toolCalls };
    }

    // Append the assistant turn verbatim so the next call sees it.
    messages.push(res.assistantMessage);

    const results = [];
    for (const call of res.toolCalls) {
      toolCalls++;
      const tool = toolByName.get(call.name);
      let output;
      if (!tool) {
        output = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          output = await tool.execute(call.input);
        } catch (err) {
          output = { error: err?.message || String(err) };
        }
      }
      results.push({
        tool_use_id: call.id,
        name: call.name,
        output,
      });
    }

    messages.push(client.toolResultMessage(results));
  }

  // Hit maxSteps — return whatever we've got so the operator knows.
  return {
    text: finalText || '(loop stopped at maxSteps with no final text)',
    steps,
    toolCalls,
  };
}

// ─── Provider adapters ──────────────────────────────────────────────
//
// Each client exposes:
//   chat({ apiKey, model, system, messages, tools }) ->
//     { text, toolCalls: [{ id, name, input }], assistantMessage }
//   toolResultMessage(results) -> message in that provider's format
//
// The wire formats differ enough between providers that the cleanest
// thing is a tiny adapter per provider. We only ship Anthropic right
// now to keep the demo tight; google and openai are sketched in
// comments and left as follow-ups.

function pickClient(provider) {
  switch (provider) {
    case 'anthropic':
      return anthropicClient;
    default:
      throw new Error(
        `Provider "${provider}" not implemented yet. ` +
          `Only 'anthropic' is wired in this demo — google and openai are sketched as follow-ups in loop.js.`,
      );
  }
}

const anthropicClient = {
  async chat({ apiKey, model, system, messages, tools }) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Browser-side calls need this header or Anthropic blocks the request.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system,
        messages,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();

    const textBlocks = data.content.filter((b) => b.type === 'text');
    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');

    return {
      text: textBlocks.map((b) => b.text).join('\n'),
      toolCalls: toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input,
      })),
      assistantMessage: {
        role: 'assistant',
        content: data.content,
      },
    };
  },
  toolResultMessage(results) {
    return {
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: JSON.stringify(r.output),
      })),
    };
  },
};

// TODO (google): /v1beta/models/{model}:generateContent with
// functionDeclarations and functionResponse. Same loop shape, different
// wire format — add when the demo needs multi-provider support.
//
// TODO (openai): /v1/chat/completions with tools + tool_calls +
// role:'tool' response messages. Same deal.
