import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { SenderProfileManagement, type FirstProfile, type SenderProfileRow } from "./SenderProfileManagement";

export default async function SenderProfilesPage() {
  await requireAdmin();
  const [profiles, settings] = await Promise.all([
    prisma.senderProfile.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { invoices: true, quotes: true } } },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);
  const c = settings?.companyInfo;
  const first: FirstProfile = {
    companyName: c?.companyName ?? null,
    companyHolderName: c?.companyHolderName ?? null,
    companyEmail: c?.companyEmail ?? null,
    companyPhone: c?.companyPhone ?? null,
    hasLogo: !!c?.companyLogo,
  };
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
        <h1 className="text-2xl font-semibold">Absender-Profile</h1>
        <p className="text-muted-foreground mt-1">
          Das erste Profil sind die Firmendaten mit Firmenlogo aus den Einstellungen (unten als Karte). Hier legen Sie
          nur weitere Profile an: Sie überschreiben nur, was dort ausgefüllt ist; alles andere (auch Adresse und IBAN)
          kommt aus den Firmendaten. Änderungen wirken auch auf Entwürfe und Offerten, die das Profil schon verwenden. Versendete Rechnungen
          bleiben unverändert (PDF-Archiv).
        </p>
      </div>
      <SenderProfileManagement first={first} profiles={rows} />
    </div>
  );
}
