// The site header renders <AuthNav />, which reads React context published by
// components/AuthProvider. Tests render pages as bare functions rather than
// inside the real provider tree (see register-next-navigation-stub.cjs for the
// same situation with next/navigation), so useAuth() would throw its
// "must be used inside an AuthProvider" guard. That guard is correct in the
// app and worth keeping, so stub the module here instead of loosening it.
//
// The stubbed state is unauthenticated, which is what an anonymous visitor
// sees and therefore what the existing page snapshots assert against. Tests
// that need real auth behaviour exercise the flow directly in auth.test.ts.
const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function load(request, parent, isMain) {
  if (request === "@/components/AuthProvider") {
    return {
      __esModule: true,
      AuthProvider: ({ children }) => children,
      useAuth: () => ({
        status: "unauthenticated",
        user: null,
        session: null,
        requestCode: async () => ({ ok: true }),
        verifyCode: async () => ({ ok: true }),
        signOut: async () => ({ ok: true }),
      }),
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
