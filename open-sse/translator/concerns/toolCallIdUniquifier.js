/**
 * Rewrites duplicate tool_call_ids so every emitted id is unique across the
 * WHOLE request history.
 *
 * Several upstreams validate id uniqueness conversation-wide (Gemini
 * functionCall ids, OpenAI Responses function_call ↔ function_call_output
 * correlation), while an OpenAI tool_call_id is only guaranteed unique within
 * its own assistant turn. A long agent session that replays ids would otherwise
 * be rejected — Gemini with 400 INVALID_ARGUMENT, strict Responses backends
 * (Meta/Muse) with "Duplicate function_call_output for call_id ...".
 *
 * Ids that were already unique are passed through untouched, so a valid history
 * is byte-identical to before.
 *
 * Two correlation shapes exist, so the helper exposes both:
 *  - `next(id)` assigns the id for one occurrence. The caller keeps the return
 *    value and reuses it for the paired output it emits in the SAME pass
 *    (the gemini translator builds functionCall + functionResponse together).
 *  - `take(id)` / `match(id)` split the pair across passes: `take` on the call
 *    site enqueues an emission, `match` on the output site dequeues the oldest
 *    one still owed for that id (the responses translator, where the
 *    function_call and its function_call_output come from different messages).
 *    Calls must be emitted in the same order their outputs appear.
 *
 * `match(id)` NEVER allocates an id: with no emission owed for `id` it returns
 * null. The caller must then make the output answer SOMETHING — the responses
 * translator emits a synthetic `next(id)` call for it, so the invariant "every
 * emitted output has exactly one emitted call" holds even for orphan outputs
 * (a tool result with no call), duplicate results for one call, and output
 * appearing before the call that owns it. Telling the caller "no pending call"
 * is the whole point: silently inventing `<id>-2` there would pair the output
 * with an id no call carries, which strict backends reject.
 */
export function createToolCallIdUniquifier() {
  const used = new Set();
  const owed = new Map(); // original id -> [emitted id, ...] awaiting an output

  function pick(id) {
    if (!id) return id;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
    let n = 2;
    let candidate = `${id}-${n}`;
    while (used.has(candidate)) candidate = `${id}-${++n}`;
    used.add(candidate);
    return candidate;
  }

  return {
    next(id) {
      return pick(id);
    },
    take(id) {
      const emitId = pick(id);
      if (id) {
        if (!owed.has(id)) owed.set(id, []);
        owed.get(id).push(emitId);
      }
      return emitId;
    },
    match(id) {
      const queue = owed.get(id);
      if (!queue || queue.length === 0) return null;
      return queue.shift();
    }
  };
}
