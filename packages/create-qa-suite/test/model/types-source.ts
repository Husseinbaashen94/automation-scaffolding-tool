import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const modelTypesSource = () => readFileSync(join(import.meta.dirname, '../../template/base/support/types.ts'), 'utf8');
