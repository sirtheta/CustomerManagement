import { NextRequest, NextResponse } from "next/server";

// Optimistic auth check: read NextAuth session cookie without verifying JWT.
// Full verification happens in Server Components via auth() from lib/auth.ts.
const SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

// Builds a per-request Content-Security-Policy. script-src uses a nonce plus
// 'strict-dynamic' so only this request's scripts (and what they load) run —
// no 'unsafe-inline', which is what gives real protection against injected
// inline scripts. 'unsafe-eval' is only needed in dev (React uses eval for
// debugging). style-src keeps 'unsafe-inline' because nonces do not cover
// inline style attributes and style injection is far lower risk.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Allow same-origin blob: URLs to be framed (PDF live preview uses an
    // <iframe src="blob:..."> generated from a POST response).
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Forward the nonce + CSP to the renderer so Next.js applies the nonce to
  // its framework and page scripts during SSR.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // NextAuth API routes and the machine-to-machine external API pass
  // through without the auth redirect — /api/external/* authenticates
  // callers itself via x-api-key (see app/api/external/payments/route.ts),
  // and has no session cookie to redirect on. Without this exclusion, a
  // server-to-server caller (e.g. the Budget app) gets redirected to
  // /login and fetch() silently follows it, handing back the login page's
  // HTML where JSON was expected.
  if (!pathname.startsWith("/api/auth") && !pathname.startsWith("/api/external")) {
    const isLoggedIn = !!request.cookies.get(SESSION_COOKIE)?.value;
    const isLoginPage = pathname.startsWith("/login");

    if (isLoggedIn && isLoginPage) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    if (!isLoggedIn && !isLoginPage) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
