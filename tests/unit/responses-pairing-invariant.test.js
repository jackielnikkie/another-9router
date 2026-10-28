import { describe, expect, it } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../../open-sse/translator/schema/index.js";

// Adversarial pairing tests for openaiToOpenAIResponsesRequest. The invariant:
//  1. every function_call_output.call_id has EXACTLY ONE function_call with it
//  2. every function_call.call_id is answered by AT MOST ONE function_call_output
//  3. all call_ids are globally unique per item type
// Each case funnels through the single assertPairing helper.

const MODEL = "muse-spark-1.3";

const translate = (messages) =>
  openaiToOpenAIResponsesRequest(MODEL, { model: MODEL, messages }, false, null);

const pair = (id, name, args) => ({
  role: ROLE.ASSISTANT,
  tool_calls: [{ id, type: OPENAI_BLOCK.FUNCTION, function: { name, arguments: JSON.stringify(args || {}) } }],
});
const pairMulti = (calls) => ({
  role: ROLE.ASSISTANT,
  tool_calls: calls.map(([id, name, args]) => ({
    id, type: OPENAI_BLOCK.FUNCTION, function: { name, arguments: JSON.stringify(args || {}) },
  })),
});
const result = (id, content) => ({ role: ROLE.TOOL, tool_call_id: id, content });

// Single shared invariant checker. Throws a message naming the offending call_id.
function assertPairing(out) {
  const calls = [];
  const outputs = [];
  for (const item of out.input || []) {
    expect(item.type, "input item has a type").toBeTruthy();
    if (item.type === RESPONSES_ITEM.FUNCTION_CALL) calls.push(item.call_id);
    if (item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) outputs.push(item.call_id);
  }

  // No emitted item may carry a null/undefined/empty call_id.
  for (const id of [...calls, ...outputs]) {
    expect(typeof id === "string" && id.length > 0, `call_id must be non-empty string, got ${JSON.stringify(id)}`).toBe(true);
  }

  const callSet = new Set(calls);
  const outputCounts = new Map();
  for (const id of outputs) outputCounts.set(id, (outputCounts.get(id) || 0) + 1);

  // Bullet 1: output answers exactly one call.
  for (const id of outputs) {
    expect(callSet.has(id), `function_call_output ${id} has no matching function_call`).toBe(true);
  }
  // Bullet 2: a call is answered by at most one output.
  for (const [id, n] of outputCounts) {
    expect(n, `function_call ${id} answered by ${n} outputs`).toBe(1);
  }
  // Bullet 3: uniqueness per id-role.
  expect(new Set(calls).size, "duplicate function_call call_id").toBe(calls.length);
  expect(new Set(outputs).size, "duplicate function_call_output call_id").toBe(outputs.length);

  return { calls, outputs };
}

describe("responses pairing invariant — adversarial", () => {
  it("1a. same tool_call_id replayed across 3 turns", () => {
    const messages = [];
    for (let t = 0; t < 3; t++) {
      messages.push({ role: ROLE.USER, content: `turn ${t}` });
      messages.push(pair("call_51859", "bash", { command: `echo ${t}` }));
      messages.push(result("call_51859", `${t}`));
    }
    const { calls, outputs } = assertPairing(translate(messages));
    expect(calls).toHaveLength(3);
    expect(outputs).toHaveLength(3);
  });

  it("1b. same tool_call_id replayed across 5 turns", () => {
    const messages = [];
    for (let t = 0; t < 5; t++) {
      messages.push(pair("call_replay", "bash", { command: `echo ${t}` }));
      messages.push(result("call_replay", `${t}`));
    }
    assertPairing(translate(messages));
  });

  it("1c. same tool_call_id replayed across 10 turns", () => {
    const messages = [];
    for (let t = 0; t < 10; t++) {
      messages.push({ role: ROLE.USER, content: `t${t}` });
      messages.push(pair("call_replay", "bash", { command: `echo ${t}` }));
      messages.push(result("call_replay", `${t}`));
    }
    const { calls, outputs } = assertPairing(translate(messages));
    expect(calls).toHaveLength(10);
    expect(new Set(calls).size).toBe(10);
  });

  it("2a. multiple tool_calls, only some have results (results in call order)", () => {
    assertPairing(translate([
      pairMulti([["a", "f1", {}], ["b", "f2", {}], ["c", "f3", {}]]),
      result("a", "ra"),
      // b has no output
      result("c", "rc"),
    ]));
  });

  it("2b. multiple tool_calls, results in reverse / scrambled order", () => {
    assertPairing(translate([
      pairMulti([["a", "f1", {}], ["b", "f2", {}], ["c", "f3", {}]]),
      result("c", "rc"),
      result("a", "ra"),
      result("b", "rb"),
    ]));
  });

  it("2c. only the LAST of several calls has a result", () => {
    const { calls, outputs } = assertPairing(translate([
      pairMulti([["a", "f1", {}], ["b", "f2", {}], ["c", "f3", {}]]),
      result("c", "rc"),
    ]));
    expect(calls).toHaveLength(3);
    expect(outputs).toHaveLength(1);
  });

  it("3. pure orphan tool result whose id never appears in any assistant tool_calls", () => {
    const { calls, outputs } = assertPairing(translate([
      { role: ROLE.USER, content: "hi" },
      result("call_orphan", "no call anywhere"),
    ]));
    expect(calls).toHaveLength(1);
    expect(outputs).toEqual(calls);
  });

  it("4. two results for one call AND a third for a different call, interleaved", () => {
    const { calls, outputs } = assertPairing(translate([
      pairMulti([["x", "fx", {}], ["y", "fy", {}]]),
      result("x", "x1"),
      result("y", "y1"),
      result("x", "x2"),
    ]));
    expect(outputs).toHaveLength(3);
    expect(new Set(outputs).size).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it("5. two distinct ids sharing the same first 64 chars (truncation collision)", () => {
    const base = "call_" + "a".repeat(80);
    const a = base + "_one";
    const b = base + "_two";
    expect(a.slice(0, 64)).toBe(b.slice(0, 64));
    const { calls, outputs } = assertPairing(translate([
      pair(a, "bash", { command: "1" }), result(a, "1"),
      pair(b, "bash", { command: "2" }), result(b, "2"),
    ]));
    expect(calls).toHaveLength(2);
    expect(outputs).toEqual(calls);
  });

  it("6. empty / null / undefined / non-string ids in tc.id and msg.tool_call_id do not throw", () => {
    const histories = [
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: "", type: OPENAI_BLOCK.FUNCTION, function: { name: "f", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: "", content: "r" },
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: null, type: OPENAI_BLOCK.FUNCTION, function: { name: "f", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: null, content: "r" },
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: undefined, type: OPENAI_BLOCK.FUNCTION, function: { name: "f", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: undefined, content: "r" },
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: 12345, type: OPENAI_BLOCK.FUNCTION, function: { name: "f", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: 12345, content: "r" },
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: { x: 1 }, type: OPENAI_BLOCK.FUNCTION, function: { name: "f", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: { x: 1 }, content: "r" },
      ],
    ];
    for (const messages of histories) {
      let out;
      expect(() => { out = translate(messages); }, "translator must not throw").not.toThrow();
      assertPairing(out);
    }
  });

  it("6b. the SAME non-string/null id replayed across turns still pairs (clamp regenerates per occurrence)", () => {
    const replays = [
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: 7, type: OPENAI_BLOCK.FUNCTION, function: { name: "a", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: 7, content: "1" },
        { role: ROLE.ASSISTANT, tool_calls: [{ id: 7, type: OPENAI_BLOCK.FUNCTION, function: { name: "b", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: 7, content: "2" },
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: null, type: OPENAI_BLOCK.FUNCTION, function: { name: "a", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: null, content: "1" },
        { role: ROLE.ASSISTANT, tool_calls: [{ id: null, type: OPENAI_BLOCK.FUNCTION, function: { name: "b", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: null, content: "2" },
      ],
    ];
    for (const messages of replays) {
      let out;
      expect(() => { out = translate(messages); }).not.toThrow();
      assertPairing(out);
    }
  });

  it("7. nameless tool_call (skipped by translator) with a matching tool result still gets a synthetic call", () => {
    const histories = [
      [
        // directly skipped: no function_call emitted, output must synthesize one
        { role: ROLE.ASSISTANT, tool_calls: [{ id: "call_x", type: OPENAI_BLOCK.FUNCTION, function: {} }] },
        result("call_x", "result for a nameless call"),
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: "call_y", type: OPENAI_BLOCK.FUNCTION, function: { name: "" } }] },
        result("call_y", "empty name"),
      ],
      [
        { role: ROLE.ASSISTANT, tool_calls: [{ id: "call_z", type: OPENAI_BLOCK.FUNCTION, function: { name: "   " } }] },
        result("call_z", "whitespace name"),
      ],
    ];
    for (const messages of histories) {
      let out;
      expect(() => { out = translate(messages); }, "translator must not throw").not.toThrow();
      const { calls, outputs } = assertPairing(out);
      expect(calls, "synthetic call must be emitted for the orphaned output").toHaveLength(1);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toBe(calls[0]);
    }
  });

  it("8. result appears BEFORE its owning call in array order", () => {
    const { calls, outputs } = assertPairing(translate([
      result("call_late", "early"),
      pair("call_late", "bash", { command: "echo" }),
      result("call_late", "after"),
    ]));
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs).size).toBe(2);
  });

  it("9. duplicate ids among sibling tool_calls in one assistant message", () => {
    const { calls, outputs } = assertPairing(translate([
      pairMulti([["dup", "one", {}], ["dup", "two", {}]]),
      result("dup", "1"),
      result("dup", "2"),
    ]));
    expect(new Set(calls).size).toBe(2);
    expect(new Set(outputs).size).toBe(2);
    expect(outputs).toEqual(calls);
  });

  it("10. long realistic history ~2000 messages / ~60 calls with repeated ids holds the invariant", () => {
    const messages = [{ role: ROLE.SYSTEM, content: "sys" }];
    let outputCount = 0;
    for (let turn = 0; turn < 60; turn++) {
      messages.push({ role: ROLE.USER, content: `turn ${turn}` });
      // ~20 filler messages per turn to reach ~2000 total.
      for (let f = 0; f < 20; f++) {
        messages.push({ role: turn % 2 === 0 ? ROLE.USER : ROLE.ASSISTANT, content: `filler ${turn}-${f}` });
      }
      const id = `call_repeat_${turn % 7}`; // intentionally collide across turns
      messages.push(pairMulti([[id, "bash", { command: `echo ${turn}` }]]));
      messages.push(result(id, `out ${turn}`));
      outputCount++;
    }
    expect(messages.length).toBeGreaterThanOrEqual(1200);
    let out;
    expect(() => { out = translate(messages); }, "2000-message history must not throw").not.toThrow();
    const { calls, outputs } = assertPairing(out);
    expect(outputs).toHaveLength(outputCount);
    expect(new Set(outputs).size).toBe(outputs.length);
  });
});
