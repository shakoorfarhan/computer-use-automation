import type { Page, Locator as PwLocator } from "playwright";
import type { Confidence, Locator, LocatorCandidate, LocatorStrategy } from "../artifact/schema.js";

export interface ResolvedLocator {
  locator: PwLocator;
  usedStrategy: LocatorStrategy;
  usedConfidence: Confidence;
}

function candidateToPwLocator(page: Page, candidate: LocatorCandidate, frame?: string): PwLocator {
  const root = frame ? page.frameLocator(frame) : page;
  if (candidate.strategy === "role_and_name") {
    const separatorIndex = candidate.value.indexOf(":");
    const role = candidate.value.slice(0, separatorIndex);
    const name = candidate.value.slice(separatorIndex + 1);
    return root.getByRole(role as Parameters<Page["getByRole"]>[0], { name, exact: false });
  }
  if (candidate.strategy === "text_content") {
    return root.getByText(candidate.value, { exact: false });
  }
  return root.locator(candidate.value);
}

// Tries the primary locator, then each fallback in order, so a stable
// accessible name survives even if the role changes, and vice versa.
export async function resolveLocator(page: Page, locator: Locator): Promise<ResolvedLocator> {
  const candidates = [locator.primary, ...locator.fallbacks];
  for (const candidate of candidates) {
    const pwLocator = candidateToPwLocator(page, candidate, locator.frame);
    const count = await pwLocator.count().catch(() => 0);
    if (count > 0) {
      return {
        locator: pwLocator.first(),
        usedStrategy: candidate.strategy,
        usedConfidence: candidate.confidence,
      };
    }
  }
  throw new Error(
    `No locator candidate resolved (tried ${candidates.length}): primary=${locator.primary.strategy}:${locator.primary.value}`
  );
}
