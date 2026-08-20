// Next discovers proxy files under src/ when an application has a src tree.
// The implementation remains at the repository root in middleware.ts for
// compatibility with Next releases that still use that convention.
export { middleware as proxy } from "../middleware";

export const config = {
  matcher: ["/api/:path*"],
};
