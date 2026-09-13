import type { Page } from "playwright";

const MAX_CHARS = 12000;

export async function snapshotAccessibleText(page: Page): Promise<string> {
  const snapshot = await page.ariaSnapshot({ mode: "ai" });
  if (snapshot.length <= MAX_CHARS) return snapshot;
  return snapshot.slice(0, MAX_CHARS) + "\n... (truncated)";
}
