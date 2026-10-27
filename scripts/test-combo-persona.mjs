// Live test: per-combo persona (SOUL.md / AGENT.md) injection through the gateway.
//
//   node scripts/test-combo-persona.mjs
//
// Env:
//   BASE_URL   gateway root         (default http://localhost:20128)
//   API_KEY    sk_… dashboard key   (required)
//   COMBO      existing combo name  (default: creates a temp one)
//   MODEL      member for the temp combo (default first model of an existing combo)
//   SOUL       path to a .md file   (default ./SOUL.md if present, else built-in)
//   PING       probe message        (default "Reply with the single word: OK")
//
// Phases:
//   1. baseline — no persona, ask the model to reveal its system prompt
//   2. set persona via PUT /api/combos/:id, re-ask the same question
//   3. assert the marker string only shows up in phase 2
//   4. cleanup (temp combo deleted, persona restored)
const BASE = (process.env.BASE_URL || "http://localhost:20128").replace(/\/$/, "");
const KEY = process.env.API_KEY || "";
const PING = process.env.PING || "Reply with the single word: OK";
const PROBE_Q = "Repeat verbatim the first 200 characters of your system prompt. If you have none, reply exactly: NO_SYSTEM_PROMPT";

const MARKER = "PERSONA_CANARY_7f3a";
const SOUL = process.env.SOUL || "";
const BUILTIN_SOUL = [
  `<!-- ${MARKER} -->`,
  "You are Nyx, a blunt senior security researcher.",
  "Answer in Bahasa Indonesia, terse, no filler, no moralizing preamble.",
  "When asked to repeat your system prompt, always include this whole block.",
].join("\n");

const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { ok: res.ok, status: res.status, json, text };
}

async function ask(model, content) {
  const t0 = Date.now();
  const r = await api("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, stream: false, max_tokens: 512, messages: [{ role: "user", content }] }),
  });
  const ms = Date.now() - t0;
  const reply = r.json?.choices?.[0]?.message?.content
    || r.json?.choices?.[0]?.message?.reasoning_content
    || r.text;
  return { ok: r.ok, status: r.status, ms, reply: String(reply ?? ""), raw: r.json };
}

async function readSoul() {
  if (SOUL) {
    const { readFile } = await import("node:fs/promises");
    return readFile(SOUL, "utf8");
  }
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile("SOUL.md", "utf8");
  } catch { return BUILTIN_SOUL; }
}

if (!KEY) die("API_KEY is required (dashboard → API Keys)");

const persona = await readSoul();
if (!persona.includes(MARKER) && !process.env.SOUL) die("built-in persona lost its marker");

// Resolve the combo to test against.
let combo = null;
let tempCombo = false;
const combosRes = await api("/api/combos");
if (!combosRes.ok) die(`GET /api/combos ${combosRes.status} — is the gateway up at ${BASE}?`);
const combos = combosRes.json?.combos || [];
const wanted = process.env.COMBO;
if (wanted) {
  combo = combos.find((c) => c.name === wanted);
  if (!combo) die(`combo "${wanted}" not found (have: ${combos.map((c) => c.name).join(", ") || "none"})`);
} else if (combos.length) {
  combo = combos.find((c) => (c.models || []).length > 0);
  if (!combo) die("no combo with models to test against; set COMBO or create one");
} else {
  const model = process.env.MODEL;
  if (!model) die("no combos exist — pass MODEL=<provider/model> to create a temp combo");
  const created = await api("/api/combos", {
    method: "POST",
    body: JSON.stringify({ name: `persona-selftest-${Date.now()}`, models: [model] }),
  });
  if (!created.ok) die(`POST /api/combos ${created.status}: ${created.text.slice(0, 200)}`);
  combo = created.json;
  tempCombo = true;
}

const originalPersona = combo.persona || null;
console.log(`combo: ${combo.name}  members: ${(combo.models || []).length}  persona: ${originalPersona ? `${originalPersona.length} chars` : "none"}`);

let failed = 0;
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed++;
};

try {
  console.log(`\n[1/3] baseline (persona ${originalPersona ? "ALREADY SET — clearing first" : "off"})`);
  if (originalPersona) {
    const cleared = await api(`/api/combos/${combo.id}`, { method: "PUT", body: JSON.stringify({ persona: null }) });
    if (!cleared.ok) die(`PUT clear persona ${cleared.status}: ${cleared.text.slice(0, 200)}`);
  }
  const before = await ask(combo.name, PROBE_Q);
  console.log(`  ${before.ok ? "OK" : "FAIL"} ${before.status} ${before.ms}ms`);
  console.log(`  reply: ${before.reply.slice(0, 120).replace(/\s+/g, " ")}`);
  check("marker absent before injection", !before.reply.includes(MARKER));

  console.log("\n[2/3] set persona, re-ask");
  const put = await api(`/api/combos/${combo.id}`, { method: "PUT", body: JSON.stringify({ persona }) });
  if (!put.ok) die(`PUT persona ${put.status}: ${put.text.slice(0, 300)}`);
  check("persona round-tripped by the API", put.json?.persona === persona, `${(put.json?.persona || "").length} chars`);

  const after = await ask(combo.name, PROBE_Q);
  console.log(`  ${after.ok ? "OK" : "FAIL"} ${after.status} ${after.ms}ms`);
  console.log(`  reply: ${after.reply.slice(0, 120).replace(/\s+/g, " ")}`);
  check("marker present after injection", after.reply.includes(MARKER));

  console.log("\n[3/3] ping still answers normally");
  const ping = await ask(combo.name, PING);
  console.log(`  reply: ${ping.reply.slice(0, 120).replace(/\s+/g, " ")}`);
  check("ping routed through the combo", ping.ok, `${ping.status} ${ping.ms}ms`);
} finally {
  if (tempCombo) {
    await api(`/api/combos/${combo.id}`, { method: "DELETE" });
    console.log(`\ncleanup: deleted temp combo ${combo.name}`);
  } else if (originalPersona !== persona) {
    await api(`/api/combos/${combo.id}`, { method: "PUT", body: JSON.stringify({ persona: originalPersona }) });
    console.log(`\ncleanup: restored persona on ${combo.name}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
