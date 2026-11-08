// Registers tests/ts-hooks.mjs so `node --test` can import the app's
// real TypeScript modules (see ts-hooks.mjs). Loaded via
// `node --test --import ./tests/register-ts-loader.mjs`.
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);
