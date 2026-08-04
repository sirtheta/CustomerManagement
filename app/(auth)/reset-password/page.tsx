import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl text-center">Ungültiger Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Diesem Link fehlt das Token. Bitte fordere einen neuen Zurücksetzungslink an.
            </p>
            <Button
              variant="outline"
              className="w-full"
              render={<Link href="/forgot-password" />}
            >
              Neuen Link anfordern
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
