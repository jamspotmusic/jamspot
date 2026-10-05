// lib/supabase-server.ts reads the session out of `cookies()` from
// next/headers. That function only works inside a real request scope and
// throws anywhere else, so route tests could not call it at all. Stub it the
// same way register-next-navigation-stub.cjs stubs next/navigation.
//
// The store is exposed on globalThis so a test can seed a session cookie; left
// empty, @supabase/ssr finds no session and reports an unauthenticated caller,
// which is exactly the state the 401 paths need.
const Module = require("node:module");

const cookieStore = new Map();

globalThis.__testCookies = {
  set(name, value) {
    cookieStore.set(name, value);
  },
  clear() {
    cookieStore.clear();
  },
};

const originalLoad = Module._load;

Module._load = function load(request, parent, isMain) {
  if (request === "next/headers") {
    return {
      __esModule: true,
      cookies: async () => ({
        getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
        get: (name) =>
          cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined,
        set: (name, value) => cookieStore.set(name, value),
        delete: (name) => cookieStore.delete(name),
      }),
      headers: async () => new Headers(),
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
