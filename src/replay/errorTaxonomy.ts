import type { Page } from "playwright";
import type { ErrorTaxonomyEntry } from "../artifact/schema.js";

// Concrete fault vocabulary for the teller console mock app (see PLAN.md §5
// fault injection). Mirrors the runtime conditions called out in the
// assessment PDF: not-found, permission denial, session expiry, and app error.
export const TELLER_CONSOLE_ERROR_TAXONOMY: ErrorTaxonomyEntry[] = [
  {
    signature: "heading:Member Not Found",
    classification: "business_outcome",
    description:
      "No member record exists for the given ID — a legitimate lookup result, not a system fault.",
  },
  {
    signature: "heading:Permission Denied",
    classification: "business_outcome",
    description:
      "The teller's role is not authorized for this record — a legitimate access-control result.",
  },
  {
    signature: "redirect:session_expired",
    classification: "recoverable",
    description:
      "The session expired mid-flow; replay re-authenticates once and retries the remaining steps.",
  },
  {
    signature: "heading:Internal Error",
    classification: "hard_failure",
    description: "The backend returned an unexpected server error; stop and surface for debugging.",
  },
  {
    signature: "timeout",
    classification: "recoverable",
    description:
      "A page load or element wait exceeded the normal timeout; retried once with an extended timeout before failing hard.",
  },
];

export interface DetectedFault {
  signature: string;
}

export async function detectKnownFault(page: Page): Promise<DetectedFault | null> {
  const url = page.url();
  if (url.includes("/login") && url.includes("reason=session_expired")) {
    return { signature: "redirect:session_expired" };
  }
  const heading = await page
    .locator(".error-box strong")
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);
  if (heading?.includes("Member Not Found")) return { signature: "heading:Member Not Found" };
  if (heading?.includes("Permission Denied")) return { signature: "heading:Permission Denied" };
  if (heading?.includes("Internal Error")) return { signature: "heading:Internal Error" };
  return null;
}
