// Test files call page/component functions directly rather than through a
// real React render, so there's no active hook dispatcher. next/navigation's
// hooks reach into React internals (unlike the useState/useMemo/useEffect
// patches tests install by hand) and crash outside a real render. Stub them
// out the same way register-next-image-stub.cjs stubs next/image.
const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function load(request, parent, isMain) {
  if (request === "next/navigation") {
    return {
      __esModule: true,
      usePathname: () => "/",
      // AuthNav calls router.refresh() after signing out so Server Components
      // re-render without the session. No-ops are enough for static rendering.
      useRouter: () => ({
        refresh() {},
        push() {},
        replace() {},
        back() {},
        forward() {},
        prefetch() {},
      }),
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
