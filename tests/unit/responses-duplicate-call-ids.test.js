import { describe, expect, it } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

// Sibling of gemini-duplicate-tool-call-ids.test.js for the Responses wire.
// Strict Responses backends (Meta / Muse) reject a request whose
// function_call_output call_ids repeat — "Duplicate function_call_output for
// call_id". An OpenAI tool_call_id is only unique within its own assistant turn,
// so a replayed agent history collides. Truncation (clampResponsesCallId) does
// not dedup, so the emitted call_id must be uniquified per occurrence.

const pair = (id, name, args) => ({
  role: "assistant",
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args || {}) } }],
});
const result = (id, content) => ({ role: "tool", tool_call_id: id, content });

function emitted(messages) {
  const out = openaiToOpenAIResponsesRequest(
    "muse-spark-1.3",
    { model: "muse-spark-1.3", messages },
    false,
    null
  );
  const calls = [];
  const outputs = [];
  for (const item of out.input || []) {
    if (item.type === "function_call") calls.push({ call_id: item.call_id, name: item.name });
    if (item.type === "function_call_output") outputs.push(item.call_id);
  }
  return { calls, outputs };
}

describe("duplicate tool_call_ids are uniquified on the Responses wire", () => {
  const twoTurns = [
    { role: "user", content: "run step 1" },
    pair("call_51859", "bash", { command: "echo 1" }),
    result("call_51859", "1"),
    { role: "user", content: "run step 2" },
    pair("call_51859", "bash", { command: "echo 2" }),
    result("call_51859", "2"),
  ];

  it("emits a distinct call_id for each occurrence", () => {
    const { calls, outputs } = emitted(twoTurns);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.call_id)).size).toBe(2);
    // Every output must answer a call, and no id may repeat.
    expect(new Set(outputs).size).toBe(outputs.length);
    expect(outputs).toEqual(calls.map((c) => c.call_id));
  });

  it("leaves the FIRST occurrence untouched", () => {
    expect(emitted(twoTurns).calls[0].call_id).toBe("call_51859");
  });

  it("uniquifies duplicates among sibling calls in ONE turn", () => {
    const { calls } = emitted([
      {
        role: "assistant",
        tool_calls: [
          { id: "dup", type: "function", function: { name: "one", arguments: "{}" } },
          { id: "dup", type: "function", function: { name: "two", arguments: "{}" } },
        ],
      },
      result("dup", "1"),
      result("dup", "2"),
    ]);
    expect(new Set(calls.map((c) => c.call_id)).size).toBe(2);
  });

  it("leaves an already-unique conversation completely unchanged", () => {
    const { calls, outputs } = emitted([
      pair("call_a", "alpha", {}), result("call_a", "1"),
      pair("call_b", "beta", {}), result("call_b", "2"),
    ]);
    expect(calls.map((c) => c.call_id)).toEqual(["call_a", "call_b"]);
    expect(outputs).toEqual(["call_a", "call_b"]);
  });
});
