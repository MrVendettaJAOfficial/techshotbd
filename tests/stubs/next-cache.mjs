// "next/cache" stub for `node --test` (test-only).
//
// The real module cannot be imported under plain Node. These are
// the only members the server modules under test use:
//   - revalidatePath / revalidateTag: no-ops that record their calls
//     (tests assert on the calls, so a banner write that forgets to
//     purge the catalog tag is caught here, not just in source text);
//   - unstable_cache: passthrough — the wrapped function is returned
//     as-is, so no cross-request caching happens in tests and every
//     call re-runs the live fetch against the stub client.

export const revalidatePathCalls = [];
export const revalidateTagCalls = [];

export function revalidatePath(path) {
  revalidatePathCalls.push(path);
}

export function revalidateTag(tag) {
  revalidateTagCalls.push(tag);
}

export function unstable_cache(fn) {
  return fn;
}

export function redirect() {
  throw new Error("redirect() is not available in unit tests");
}
