import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { coverage, findElement, findPage, findRole } from './coverage.js';
import { pageUrl, stepToAction, type StepAction } from './steps.js';
import type { Step, Value } from './types.js';
import { resolveValue } from './values.js';

const ctx = () => ({ env: process.env, saved: {} as Record<string, Value> });
export const stepContext = () => ({
  element: findElement,
  page: (id: string) => findPage(id).path,
  resolve: (v: Value) => resolveValue(v, ctx()),
  baseUrl: coverage.settings.uiBaseUrl,
});

/** Performs one step on the page. */
export async function runAction(page: Page, a: StepAction): Promise<void> {
  if (a.kind === 'goto') await page.goto(a.url);
  else if (a.kind === 'url') await expect(page).toHaveURL(a.pattern);
  else if (a.kind === 'action') await (page.locator(a.selector)[a.method] as (...args: unknown[]) => Promise<unknown>)(...a.args);
  else await (expect(page.locator(a.selector))[a.matcher] as (...args: unknown[]) => Promise<void>)(...a.args);
}

export async function runSteps(page: Page, steps: Step[], step: (title: string, body: () => Promise<void>) => Promise<void>): Promise<void> {
  for (const s of steps) {
    const action = stepToAction(s, stepContext());
    await step(action.describe, () => runAction(page, action));
  }
}

const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** A browser context logged in as the role (guest: a fresh context). Logs in once per worker. */
export async function contextFor(browser: Browser, roleId: string): Promise<BrowserContext> {
  const role = findRole(roleId);
  if (!role) return browser.newContext();
  if (!role.ui) throw new Error(`role "${roleId}" has no ui.loginFlow, so it can't be used in UI checks`);
  let state = sessions.get(roleId);
  if (!state) {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const s of role.ui.loginFlow) await runAction(page, stepToAction(s, stepContext()));
    await page.waitForLoadState();
    state = await context.storageState();
    sessions.set(roleId, state);
    await context.close();
  }
  return browser.newContext({ storageState: state });
}

export const openPage = (page: Page, pageId: string) => page.goto(pageUrl(coverage.settings.uiBaseUrl, findPage(pageId).path));
