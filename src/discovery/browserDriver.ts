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

// Fixed local CDP port for the escalation demo. Playwright's own connect()
// protocol does NOT expose one client's contexts to a second independent
// client; only raw CDP (chromium.connectOverCDP) reflects the real, shared
// browser target list, which is what a genuine operator handoff needs.
const CDP_PORT = 9333;

export class BrowserDriver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private cdpEndpoint?: string;

  async launch(headless: boolean): Promise<void> {
    this.cdpEndpoint = `http://127.0.0.1:${CDP_PORT}`;
    this.browser = await chromium.launch({
      headless,
      args: [`--remote-debugging-port=${CDP_PORT}`],
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  getWsEndpoint(): string {
    if (!this.cdpEndpoint) throw new Error("BrowserDriver not launched");
    return this.cdpEndpoint;
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

  // Terminates the whole browser process. Skip this while an escalation
  // ticket is outstanding — the operator's separate CDP connection needs the
  // browser to stay alive.
  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}
