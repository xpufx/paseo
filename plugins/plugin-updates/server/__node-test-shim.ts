/**
 * Minimal `node:test` → vitest shim.
 *
 * Used only by `plugins/plugin-updates/vitest.config.ts` so the plugin's
 * `node:test` files can run under vitest when `tsx` is unavailable. It supports
 * the surface these tests actually use: default `test(name, fn)` plus
 * `test.describe`.
 */
import { it, describe } from "vitest";

const test: any = (name: string, fn: any) => it(name, fn);
test.describe = describe;

export default test;
