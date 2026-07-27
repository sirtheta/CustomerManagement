"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

export type LoginState = {
  error?: string;
  // Password was correct but the account has TOTP enabled: the form should
  // show the code field and resubmit with it instead of showing an error.
  totpRequired?: boolean;
};

export async function login(
  _prev: LoginState | undefined,
  formData: FormData
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      totpCode: formData.get("totpCode") ?? "",
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      const code = (error as AuthError & { code?: string }).code;
      if (code === "totp_required") return { totpRequired: true };
      if (code === "totp_invalid") return { totpRequired: true, error: "Ungültiger Code." };
      return { error: "Ungültige Anmeldedaten." };
    }
    throw error; // redirect() throws — must be re-thrown
  }
}
