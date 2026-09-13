import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { snapshotAccessibleText } from "./a11y.js";

export interface Observation {
  url: string;
  title: string;
  accessibilityTree: string;
}

export interface ToolActionError {
  message: string;
}

export class BrowserDriver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  async launch(headless: boolean): Promise<void> {
    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  getPage(): Page {
    if (!this.page) throw new Error("BrowserDriver not launched");
    return this.page;
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error("BrowserDriver not launched");
    return this.context;
  }

  async goto(url: string): Promise<void> {
    await this.getPage().goto(url, { waitUntil: "domcontentloaded" });
  }

  async observe(): Promise<Observation> {
    const page = this.getPage();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return {
      url: page.url(),
      title: await page.title(),
      accessibilityTree: await snapshotAccessibleText(page),
    };
  }

  async login(username: string, password: string): Promise<void> {
    const page = this.getPage();
    await page.getByLabel("Teller ID").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForLoadState("domcontentloaded");
  }

  async clickByRole(role: string, name: string): Promise<void> {
    const page = this.getPage();
    const locator = page.getByRole(role as never, { name, exact: false });
    await locator.first().click({ timeout: 5000 });
  }

  async fillByRole(role: string, name: string, value: string): Promise<void> {
    const page = this.getPage();
    const locator = page.getByRole(role as never, { name, exact: false });
    await locator.first().fill(value, { timeout: 5000 });
  }

  async waitForRole(role: string, name: string, timeoutMs: number): Promise<void> {
    const page = this.getPage();
    await page.getByRole(role as never, { name, exact: false }).first().waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
  }

  async screenshot(path: string): Promise<void> {
    await this.getPage().screenshot({ path, fullPage: true }).catch(() => {});
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}
