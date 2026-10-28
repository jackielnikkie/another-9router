import { describe, expect, it } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

// Strict Responses backends (Meta / Muse) reject any function_call_output whose
// call_id has no matching function_call, any call with more than one output, and
// any duplicated call_id. The generator must uphold that pairing for hostile
// histories: orphan outputs, duplicate outputs, output ordered before its call,
// and long ids that collide only after truncation.

const pair = (id, name, args) => ({
  role: "assistant",
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args || {}) } }],
});
const result = (id, content) => ({ role: "tool", tool_call_id: id, content });

function emitted(messages) {
  return openaiToOpenAIResponsesRequest(
    "muse-spark-1.3",
    { model: "muse-spark-1.3", messages },
    false,
    null
  );
}

// The invariant: every output answers exactly one call, and no call is answered
// twice. Call ids are unique across the whole input.
function assertPairing(out) {
  const calls = [];
  const outputs = [];
  for (const item of out.input || []) {
    if (item.type === "function_call") calls.push(item.call_id);
    if (item.type === "function_call_output") outputs.push(item.call_id);
  }
  const callSet = new Set(calls);
  for (const id of outputs) {
    expect(callSet.has(id)).toBe(true);
  }
  const outputCounts = outputs.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  for (const [, n] of outputCounts) {
    expect(n).toBe(1);
  }
  expect(new Set(calls).size).toBe(calls.length);
  return { calls, outputs };
}

describe("function_call_output always pairs with exactly one function_call", () => {
  it("duplicate tool results for a single call pair 1:1", () => {
    const { calls, outputs } = assertPairing(emitted([
      pair("call_dup", "bash", { command: "echo" }),
      result("call_dup", "first"),
      result("call_dup", "second"),
    ]));
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs).size).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("output appearing before its owning call still pairs", () => {
    const { outputs } = assertPairing(emitted([
      result("call_late", "early"),
      pair("call_late", "bash", { command: "echo" }),
      result("call_late", "after"),
    ]));
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs).size).toBe(2);
  });

  it("wholly orphan tool result pairs via a synthetic call", () => {
    const { calls, outputs } = assertPairing(emitted([
      { role: "user", content: "hi" },
      result("call_orphan", "no call anywhere"),
    ]));
    expect(calls).toHaveLength(1);
    expect(outputs).toEqual(calls);
  });

  it("long ids colliding after truncation stay paired", () => {
    const base = "call_" + "a".repeat(80);
    const a = base + "_one";
    const b = base + "_two";
    expect(a.slice(0, 64)).toBe(b.slice(0, 64));
    const { calls, outputs } = assertPairing(emitted([
      pair(a, "bash", { command: "1" }), result(a, "1"),
      pair(b, "bash", { command: "2" }), result(b, "2"),
    ]));
    expect(calls).toHaveLength(2);
    expect(outputs).toEqual(calls);
  });

  it("mixed hostile history keeps the invariant end to end", () => {
    const out = emitted([
      pair("m1", "one", {}), result("m1", "a"),
      result("m1", "b"),
      result("m_orphan", "c"),
      result("m_late", "d"),
      pair("m_late", "two", {}), result("m_late", "e"),
    ]);
    assertPairing(out);
  });
});
