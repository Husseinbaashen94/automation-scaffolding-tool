import { UsageError } from '../cli/errors.js';
import type { Project } from '../model/types.js';
import type { UpdateResult } from './update.js';

export function planElementChange(_p: Project, _feature: string, _page: string, _element: string, _locator: string): UpdateResult {
  throw new UsageError('Element changes are not implemented yet');
}

export function planValueChange(_p: Project, _feature: string, _target: { endpoint: string } | { page: string; element: string }, _expectation: string, _narrow: { check?: string; from?: string }): UpdateResult {
  throw new UsageError('Value changes are not implemented yet');
}
