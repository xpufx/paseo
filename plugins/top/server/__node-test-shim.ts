/**
 * Minimal `node:test` → vitest shim.
 *
 * Used only by `plugins/top/vitest.config.ts` so the plugin's `node:test`
 * files can run under vitest alongside the JSX regression tests. It supports
 * the surface these tests actually use: default `test(name, fn)`,
 * `test.describe`, and the `after`/`before` suite hooks (mapped to vitest's
 * `afterAll`/`beforeAll`).
 */
import {
  it,
  test as vitestTest,
  describe,
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

const test: any = (name: string, fn: any) => it(name, fn);
test.describe = describe;
test.before = beforeAll;
test.after = afterAll;
test.beforeEach = beforeEach;
test.afterEach = afterEach;

export { vitestTest as test, describe, it, beforeEach, afterEach };
export const after = afterAll;
export const before = beforeAll;
export default test;
