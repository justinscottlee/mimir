import { NextResponse } from "next/server";
import { socialProvidersConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated endpoint exposing the small slice of auth config the
 * sign-in screen needs to render correctly: whether new account registration is
 * permitted, and which OAuth providers are configured (so a social button is
 * only shown when it will actually work). The actual enforcement happens
 * server-side in Better Auth (`disableSignUp`, the provider registration);
 * this only controls what the UI offers.
 */
export function GET() {
  return NextResponse.json({
    allowSignup: process.env.ALLOW_SIGNUP !== "false",
    social: socialProvidersConfigured(),
  });
}
