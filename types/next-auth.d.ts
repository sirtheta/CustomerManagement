import { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    };
  }
  interface User {
    role: UserRole;
    /** Credential epoch the session was issued under (see User.sessionEpoch). */
    sessionEpoch?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    /**
     * Value of `User.sessionEpoch` when this token was issued. The jwt callback
     * kills the session once the stored value no longer matches, which is how a
     * password reset revokes tokens that were already out there.
     */
    sessionEpoch?: number;
  }
}
