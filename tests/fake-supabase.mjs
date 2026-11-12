// Fake Supabase admin client for `node --test` (test-only).
//
// The real server actions take a Supabase client as a parameter
// (product helpers) or obtain it from the stubbed client factory
// (tests/stubs/supabase-server-stub.mjs). These fakes stand in for
// that client: every .from(table) call returns a chainable query
// builder that records its steps and, when awaited, resolves to
// whatever the test's `respond(table, steps)` function returns —
// or rejects, when it returns an Error (the "insert throws"
// failure mode). Storage is faked the same way, per operation.
//
// The builder deliberately mirrors only the supabase-js surface
// the code under test uses: select / eq / neq / in / like / order
// / limit / insert / update / delete / single / maybeSingle, plus
// storage .upload / .list / .remove. Await works because the
// builder is thenable, exactly like the real PostgrestFilterBuilder.

/** The mutating step of a chain ("insert" / "update" / "delete"), or "select". */
export function stepOp(steps) {
  const mutating = steps.find(([method]) => method === "insert" || method === "update" || method === "delete");
  return mutating ? mutating[0] : "select";
}

/** Arguments of the first step with this method name, or []. */
export function stepArgs(steps, method) {
  const step = steps.find(([name]) => name === method);
  return step ? step[1] : [];
}

/**
 * A fake admin client. `respond(table, steps)` decides the awaited
 * result of each query: return { data, error } for a normal
 * answer, or an Error to make the await throw. Every awaited
 * query is appended to `client.calls` as { table, steps }.
 */
export function makeFakeAdmin(respond, storage) {
  const calls = [];
  function builder(table) {
    const steps = [];
    const chain = {
      select: (...args) => {
        steps.push(["select", args]);
        return chain;
      },
      eq: (...args) => {
        steps.push(["eq", args]);
        return chain;
      },
      neq: (...args) => {
        steps.push(["neq", args]);
        return chain;
      },
      in: (...args) => {
        steps.push(["in", args]);
        return chain;
      },
      like: (...args) => {
        steps.push(["like", args]);
        return chain;
      },
      order: (...args) => {
        steps.push(["order", args]);
        return chain;
      },
      limit: (...args) => {
        steps.push(["limit", args]);
        return chain;
      },
      insert: (...args) => {
        steps.push(["insert", args]);
        return chain;
      },
      update: (...args) => {
        steps.push(["update", args]);
        return chain;
      },
      delete: (...args) => {
        steps.push(["delete", args]);
        return chain;
      },
      single: (...args) => {
        steps.push(["single", args]);
        return chain;
      },
      maybeSingle: (...args) => {
        steps.push(["maybeSingle", args]);
        return chain;
      },
      then(onFulfilled, onRejected) {
        calls.push({ table, steps });
        let outcome;
        try {
          outcome = respond(table, steps);
        } catch (error) {
          return Promise.reject(error).then(onFulfilled, onRejected);
        }
        if (outcome instanceof Error) {
          return Promise.reject(outcome).then(onFulfilled, onRejected);
        }
        return Promise.resolve(outcome).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }
  const client = {
    from: (table) => builder(table),
    calls,
  };
  if (storage) client.storage = storage;
  return client;
}

/**
 * A fake Storage client. Each operation is a function returning
 * { data, error } (or throwing): `upload(path, buffer, options)`,
 * `list(prefix, options)`, `remove(paths)`. Calls are recorded on
 * `storage.calls` as { bucket, op, args }.
 */
export function makeFakeStorage(handlers = {}) {
  const calls = [];
  return {
    calls,
    from(bucket) {
      return {
        upload: async (...args) => {
          calls.push({ bucket, op: "upload", args });
          if (handlers.upload) return handlers.upload(...args);
          return { data: { path: args[0] }, error: null };
        },
        list: async (...args) => {
          calls.push({ bucket, op: "list", args });
          if (handlers.list) return handlers.list(...args);
          return { data: [], error: null };
        },
        remove: async (...args) => {
          calls.push({ bucket, op: "remove", args });
          if (handlers.remove) return handlers.remove(...args);
          return { data: [], error: null };
        },
      };
    },
  };
}
