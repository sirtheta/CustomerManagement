import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Auth.js session cookie, also in its chunked form (".0", ".1", ...) and with
// the "__Secure-" prefix used over HTTPS.
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

export async function GET(request: NextRequest) {
  // A link to this route must not log out someone with a working session.
  if (await auth()) {
    return new NextResponse(null, { status: 307, headers: { Location: "/dashboard" } });
  }

  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: "/login?notice=session-ended", "Cache-Control": "no-store" },
  });
  for (const { name } of request.cookies.getAll()) {
    if (!SESSION_COOKIE.test(name)) continue;
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      // Browsers ignore a __Secure- cookie change that is not sent as Secure.
      secure: name.startsWith("__Secure-"),
    });
  }
  return response;
}
