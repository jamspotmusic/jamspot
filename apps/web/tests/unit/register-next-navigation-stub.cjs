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
      // The discovery routes (TEA-67) leave a route by throwing, exactly as
      // the real notFound()/redirect() do. Tests assert on the thrown error
      // rather than on a return value, so the digest strings below stand in
      // for Next's own - what matters is that control does not continue past
      // the call, which a stub returning undefined would not reproduce.
      notFound: () => {
        const error = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
        error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
        throw error;
      },
      redirect: (url) => {
        const error = new Error(`NEXT_REDIRECT;replace;${url};308;`);
        error.digest = `NEXT_REDIRECT;replace;${url};308;`;
        throw error;
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
