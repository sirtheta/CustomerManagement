import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { SenderProfileManagement, type SenderProfileRow } from "./SenderProfileManagement";

export default async function SenderProfilesPage() {
  await requireAdmin();
  const profiles = await prisma.senderProfile.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true, quotes: true } } },
  });
  const rows: SenderProfileRow[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    companyName: p.companyName,
    companyHolderName: p.companyHolderName,
    companyEmail: p.companyEmail,
    companyPhone: p.companyPhone,
    hasLogo: p.logo !== null,
    isActive: p.isActive,
    updatedAt: p.updatedAt.getTime(),
    usageCount: p._count.invoices + p._count.quotes,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Absender-Profile</h1>
        <p className="text-muted-foreground mt-1">
          Die Firmendaten und das Firmenlogo aus den Einstellungen sind das erste Profil. Ein weiteres Profil
          überschreibt nur, was dort ausgefüllt ist; alles andere (auch Adresse und IBAN) kommt aus den Firmendaten.
        </p>
      </div>
      <SenderProfileManagement profiles={rows} />
    </div>
  );
}
