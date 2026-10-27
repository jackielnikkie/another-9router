import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const NOT_FOUND = "# Changelog\n\nNo changelog found.";

function resolveChangelogPath() {
  const candidates = [
    path.join(process.cwd(), "CHANGELOG.md"),
    path.join(process.cwd(), "..", "CHANGELOG.md"),
    path.join(process.cwd(), "..", "..", "CHANGELOG.md"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export async function GET() {
  const changelogPath = resolveChangelogPath();
  let markdown = NOT_FOUND;
  if (changelogPath) {
    try {
      markdown = await readFile(changelogPath, "utf8");
    } catch {
      markdown = NOT_FOUND;
    }
  }
  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
