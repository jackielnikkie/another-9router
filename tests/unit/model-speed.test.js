import { describe, it, expect } from "vitest";
import { summarizeResults, speedTier, formatLatency, mapWithConcurrency } from "@/shared/utils/modelSpeed";

const r = (ok, latencyMs) => ({ ok, latencyMs });

describe("summarizeResults", () => {
  it("counts ok/fail and median of ok latencies (even length)", () => {
    const s = summarizeResults({ a: r(true, 100), b: r(true, 300), c: r(false, 50) });
    expect(s).toEqual({ ok: 2, fail: 1, total: 3, median: 200 });
  });

  it("median of odd length is the middle value", () => {
    const s = summarizeResults({ a: r(true, 900), b: r(true, 100), c: r(true, 400) });
    expect(s.median).toBe(400);
  });

  it("no successful results => null median", () => {
    const s = summarizeResults({ a: r(false, 10) });
    expect(s).toEqual({ ok: 0, fail: 1, total: 1, median: null });
  });

  it("empty input is safe", () => {
    expect(summarizeResults({})).toEqual({ ok: 0, fail: 0, total: 0, median: null });
    expect(summarizeResults(null)).toEqual({ ok: 0, fail: 0, total: 0, median: null });
  });
});

describe("speedTier", () => {
  it("buckets at 1000ms and 3000ms", () => {
    expect(speedTier(999)).toBe("fast");
    expect(speedTier(1000)).toBe("mid");
    expect(speedTier(2999)).toBe("mid");
    expect(speedTier(3000)).toBe("slow");
    expect(speedTier(undefined)).toBe("unknown");
  });
});

describe("formatLatency", () => {
  it("formats ms and seconds", () => {
    expect(formatLatency(840)).toBe("840ms");
    expect(formatLatency(1500)).toBe("1.5s");
    expect(formatLatency(null)).toBe("—");
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order and never exceeds the limit", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency(items, 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input and limit larger than input", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 10, async (x) => x + 1)).toEqual([2, 3]);
  });
});
