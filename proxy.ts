// Next.js 16 renamed Middleware to Proxy. Keep middleware.ts alongside this
// compatibility entry point because deployments on Next 15 still discover it.
export { middleware as proxy, config } from "./middleware";
