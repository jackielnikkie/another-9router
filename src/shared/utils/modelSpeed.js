// Summarize model ping results for the "Test All" speed card.
// ponytail: latency only. Upgrade to tokens/s needs a streamed probe in
// api/models/test/ping.js — see issue on speed metrics.

const FAST_MS = 1000;
const MID_MS = 3000;

export function summarizeResults(results) {
  const values = Object.values(results || {});
  const ok = values.filter((r) => r && r.ok);
  const fail = values.length - ok.length;
  const latencies = ok
    .map((r) => r.latencyMs)
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  let median = null;
  if (latencies.length) {
    const mid = latencies.length >> 1;
    median = latencies.length % 2
      ? latencies[mid]
      : Math.round((latencies[mid - 1] + latencies[mid]) / 2);
  }
  return { ok: ok.length, fail, total: values.length, median };
}

export function speedTier(latencyMs) {
  if (!Number.isFinite(latencyMs)) return "unknown";
  if (latencyMs < FAST_MS) return "fast";
  if (latencyMs < MID_MS) return "mid";
  return "slow";
}

// Cap parallel probes: each one is a real upstream call.
export const PROBE_CONCURRENCY = 4;

export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function formatLatency(latencyMs) {
  if (!Number.isFinite(latencyMs)) return "—";
  return latencyMs >= 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${latencyMs}ms`;
}

// Probe one model through the internal ping route. Never throws.
export async function probeModel(model, kind = "llm") {
  try {
    const res = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, kind }),
    });
    const data = await res.json();
    return {
      ok: !!data.ok,
      latencyMs: Number.isFinite(data.latencyMs) ? data.latencyMs : null,
      error: data.ok ? null : (data.error || "Model not reachable"),
    };
  } catch {
    return { ok: false, latencyMs: null, error: "Network error" };
  }
}
