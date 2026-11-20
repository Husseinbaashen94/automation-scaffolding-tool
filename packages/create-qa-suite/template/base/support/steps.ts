import type { Locator, Step, Value } from './types.js';

export type StepContext = {
  element: (ref: string) => Locator;
  page: (id: string) => string;
  resolve: (v: Value) => Value;
  baseUrl: string;
};

/** One Playwright call, described as data so it can be checked without a browser. */
export type StepAction = { describe: string } & (
  | { kind: 'goto'; url: string }
  | { kind: 'action'; selector: string; method: 'fill' | 'click' | 'selectOption' | 'check'; args: (string | number)[] }
  | { kind: 'assert'; selector: string; matcher: 'toBeVisible' | 'toBeHidden' | 'toHaveText' | 'toHaveValue' | 'toHaveCount'; args: (string | number)[] }
  | { kind: 'url'; pattern: RegExp }
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const pageUrl = (baseUrl: string, path: string) => new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString();
/** Matches a full URL whose path is exactly `path` (query and fragment allowed). */
export const pagePattern = (path: string) => new RegExp(`^[a-z]+://[^/]+${escape(path)}([?#].*)?$`);
const show = (v: Value) => (typeof v === 'string' && v.startsWith('env:') ? v : JSON.stringify(v));

/** Maps one coverage step to the Playwright call that performs or asserts it. */
export function stepToAction(step: Step, ctx: StepContext): StepAction {
  const str = (v: Value) => String(ctx.resolve(v));
  if ('goto' in step) return { kind: 'goto', url: pageUrl(ctx.baseUrl, ctx.page(step.goto)), describe: `open ${step.goto}` };
  if ('url' in step) {
    return { kind: 'url', pattern: pagePattern(ctx.page(step.url)), describe: `the URL is the ${step.url} page` };
  }
  if ('fill' in step) return { kind: 'action', selector: ctx.element(step.fill), method: 'fill', args: [str(step.value)], describe: `fill ${step.fill} with ${typeof step.value === 'string' && step.value.startsWith('env:') ? step.value : str(step.value)}` };
  if ('select' in step) return { kind: 'action', selector: ctx.element(step.select), method: 'selectOption', args: [str(step.value)], describe: `select ${show(step.value)} in ${step.select}` };
  if ('click' in step) return { kind: 'action', selector: ctx.element(step.click), method: 'click', args: [], describe: `click ${step.click}` };
  if ('check' in step) return { kind: 'action', selector: ctx.element(step.check), method: 'check', args: [], describe: `check ${step.check}` };
  if ('visible' in step) return { kind: 'assert', selector: ctx.element(step.visible), matcher: 'toBeVisible', args: [], describe: `${step.visible} is visible` };
  if ('hidden' in step) return { kind: 'assert', selector: ctx.element(step.hidden), matcher: 'toBeHidden', args: [], describe: `${step.hidden} is hidden` };
  if ('text' in step) return { kind: 'assert', selector: ctx.element(step.text), matcher: 'toHaveText', args: [str(step.equals)], describe: `${step.text} has text ${JSON.stringify(String(step.equals))}` };
  if ('count' in step) return { kind: 'assert', selector: ctx.element(step.count), matcher: 'toHaveCount', args: [step.equals], describe: `${step.count} appears ${step.equals} time(s)` };
  return { kind: 'assert', selector: ctx.element(step.value), matcher: 'toHaveValue', args: [str(step.equals)], describe: `${step.value} has value ${show(step.equals)}` };
}
