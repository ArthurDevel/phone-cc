/**
 * Clears the preview cookie and redirects to "/", returning the user
 * to the normal PhoneCC interface.
 *
 * Responsibilities:
 * - Clears the phonecc_preview cookie by setting maxAge to 0
 * - Redirects to "/"
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PREVIEW_COOKIE_NAME } from "@/lib/preview-manager";

// ============================================================================
// ENDPOINT HANDLERS
// ============================================================================

/**
 * Clears the preview cookie and redirects to "/".
 *
 * @param _request - The incoming request (unused)
 * @returns A redirect response to "/"
 */
export async function GET(_request: Request): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.set(PREVIEW_COOKIE_NAME, "", {
    maxAge: 0,
    httpOnly: true,
    path: "/",
  });

  redirect("/");
}
