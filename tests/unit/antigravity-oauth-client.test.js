// Guards that OAuth client credentials are sourced from env, not hardcoded, and
// that every consumer (shared.js + the 3 registry transports) agrees on the value.
import { describe, it, expect, beforeAll } from "vitest";

const AG_ID = "test-antigravity-client-id.apps.googleusercontent.com";
const AG_SECRET = "test-antigravity-client-secret";
const GOOGLE_ID = "test-google-client-id.apps.googleusercontent.com";
const GOOGLE_SECRET = "test-google-client-secret";

beforeAll(() => {
  process.env.ANTIGRAVITY_CLIENT_ID = AG_ID;
  process.env.ANTIGRAVITY_CLIENT_SECRET = AG_SECRET;
  process.env.GOOGLE_CLIENT_ID = GOOGLE_ID;
  process.env.GOOGLE_CLIENT_SECRET = GOOGLE_SECRET;
});

describe("antigravity oauth client (env-sourced)", () => {
  it("shared source reads credentials from env", async () => {
    const { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ANTIGRAVITY_OAUTH_CLIENT).toEqual({ clientId: AG_ID, clientSecret: AG_SECRET });
    expect(GOOGLE_OAUTH_CLIENT).toEqual({ clientId: GOOGLE_ID, clientSecret: GOOGLE_SECRET });
  });

  it("registry transport keeps clientId/clientSecret", async () => {
    const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    expect(ag.transport.clientId).toBe(AG_ID);
    expect(ag.transport.clientSecret).toBe(AG_SECRET);
  });

  it("google client shared by gemini + gemini-cli", async () => {
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    const gc = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    expect(gemini.transport.clientId).toBe(GOOGLE_ID);
    expect(gemini.transport.clientSecret).toBe(GOOGLE_SECRET);
    expect(gc.transport.clientId).toBe(GOOGLE_ID);
    expect(gc.transport.clientSecret).toBe(GOOGLE_SECRET);
  });

  // Guard: no secret literal may be reintroduced anywhere in the provider tree.
  it("no hardcoded google oauth secret in the provider tree", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      "../../open-sse/providers/shared.js",
      "../../open-sse/providers/registry/gemini.js",
      "../../open-sse/providers/registry/gemini-cli.js",
      "../../open-sse/providers/registry/antigravity.js",
      "../../src/lib/oauth/constants/oauth.js",
    ];
    for (const rel of files) {
      const src = readFileSync(join(here, rel), "utf8");
      expect(src).not.toMatch(/GOCSPX-/);
      expect(src).not.toMatch(/apps\.googleusercontent\.com/);
    }
  });

  // Guard: oauth.js must spread shared clients + derive from registry (PROVIDER_OAUTH).
  it("src oauth.js imports shared client + keeps full shape", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../../src/lib/oauth/constants/oauth.js"), "utf8");
    expect(src).toContain('import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "open-sse/providers/shared.js"');
    expect(src).toContain("...ANTIGRAVITY_OAUTH_CLIENT");
    expect(src).toContain("...GOOGLE_OAUTH_CLIENT");
    expect(src).toContain('PROVIDER_OAUTH["antigravity"]');
    expect(src).toContain('PROVIDER_OAUTH["gemini-cli"]');
  });
});
