import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated endpoint exposing the small slice of auth config the
 * sign-in screen needs to render correctly — currently just whether new account
 * registration is permitted. The actual enforcement happens server-side in
 * Better Auth (`disableSignUp`); this only controls whether the UI offers it.
 */
export function GET() {
  return NextResponse.json({
    allowSignup: process.env.ALLOW_SIGNUP !== "false",
  });
}
