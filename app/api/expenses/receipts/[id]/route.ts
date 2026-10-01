import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { RECEIPT_MIME_TYPES } from "@/lib/expense-receipts";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole([UserRole.Admin, UserRole.Editor]);

  const { id } = await params;
  const receiptId = parseInt(id, 10);
  if (isNaN(receiptId))
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });

  const receipt = await prisma.expenseReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  return new NextResponse(receipt.content, {
    headers: {
      "Content-Type": RECEIPT_MIME_TYPES[receipt.fileType] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(receipt.name)}`,
      "Cache-Control": "private, no-cache",
    },
  });
}
