/**
 * Where a request without a valid session is sent. Not /login directly: after
 * a sessionEpoch bump (password/role/TOTP change, deactivation) the browser
 * still holds the now-dead cookie, proxy.ts only checks that the cookie
 * exists and would bounce /login straight back into the app, an endless
 * loop. This route clears the cookie first (and is a harmless extra hop for
 * visitors who have none).
 */
export const SESSION_EXPIRED_PATH = "/api/auth/session-expired";
