import { register } from "node:module";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

register("./resolve-ts-hooks.mjs", import.meta.url);
