import { cookies } from "next/headers";
import { OWNER_COOKIE, verifyOwnerToken } from "@/lib/auth/owner";

/**
 * Owner resolution for Server Components, which have no `Request` to read.
 *
 * Kept apart from `owner.ts` so that module stays free of `next/headers` and remains
 * usable from the proxy and from plain unit tests.
 *
 * Calling this opts the page into dynamic rendering, which is required and not
 * incidental: a prerendered page would otherwise bake one person's rows into HTML
 * served to everyone.
 */
export async function resolveOwnerIdFromCookies(): Promise<string | null> {
  const store = await cookies();
  return verifyOwnerToken(store.get(OWNER_COOKIE)?.value);
}
