import type { Page } from "playwright";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches the label cell by EXACT text, not substring-contains, because in a
// nested-table layout every ancestor <tr> also "contains" the label text
// somewhere in its subtree — a naive hasText match on "tr" grabs the last
// matching row in the whole page, not the intended one.
export async function readRowValue(page: Page, rowLabel: string): Promise<string> {
  const labelCell = page
    .locator("th, td")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(rowLabel)}\\s*$`) })
    .first();
  const row = labelCell.locator("xpath=..");
  const valueCell = row.locator(":scope > td").last();
  const text = await valueCell.textContent({ timeout: 5000 });
  return (text ?? "").trim();
}
