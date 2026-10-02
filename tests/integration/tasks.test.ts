import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { closeAnsweredFollowUps, createQuoteFollowUp, notifyDueTasks, QUOTE_FOLLOW_UP_DAYS } from "@/lib/tasks";
import { loadCustomerHistory } from "@/lib/customer-history";

const notifyAdmins = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/notifications", () => ({ notifyAdmins: (...args: unknown[]) => notifyAdmins(...args) }));

describe("customer tasks", () => {
  const db = createTestDatabase();

  async function seedQuote(state: "Draft" | "Sent" | "Accepted" = "Sent") {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const quote = await db.prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: `Q-${Math.random().toString(36).slice(2, 8)}`,
        date: new Date(),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state,
      },
    });
    return { customer, quote };
  }

  describe("createQuoteFollowUp", () => {
    it("creates a task due seven days after sending, assigned to the sender", async () => {
      const { customer, quote } = await seedQuote();
      const user = await db.prisma.user.create({
        data: { email: "a@b.ch", name: "Ada", passwordHash: "x", role: "Editor" },
      });
      const sentAt = new Date(2026, 9, 1, 14, 30);

      await createQuoteFollowUp(db.prisma, { quoteId: quote.id, assigneeId: user.id, sentAt });

      const tasks = await db.prisma.task.findMany();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ customerId: customer.customerId, quoteId: quote.id, assigneeId: user.id });
      expect(tasks[0].title).toContain(quote.documentNumber!);
      expect(tasks[0].dueDate).toEqual(new Date(2026, 9, 1 + QUOTE_FOLLOW_UP_DAYS));
    });

    it("does not add a second open task when the quote is sent again", async () => {
      const { quote } = await seedQuote();
      await createQuoteFollowUp(db.prisma, { quoteId: quote.id });
      await createQuoteFollowUp(db.prisma, { quoteId: quote.id });
      expect(await db.prisma.task.count()).toBe(1);
    });

    it("creates a new task once the earlier one is done", async () => {
      const { quote } = await seedQuote();
      await createQuoteFollowUp(db.prisma, { quoteId: quote.id });
      await db.prisma.task.updateMany({ data: { doneAt: new Date() } });
      await createQuoteFollowUp(db.prisma, { quoteId: quote.id });
      expect(await db.prisma.task.count()).toBe(2);
    });

    it("ignores an assignee that is not a valid id", async () => {
      const { quote } = await seedQuote();
      await createQuoteFollowUp(db.prisma, { quoteId: quote.id, assigneeId: NaN });
      expect((await db.prisma.task.findFirstOrThrow()).assigneeId).toBeNull();
    });
  });

  describe("closeAnsweredFollowUps", () => {
    it("completes follow-ups of answered quotes and keeps the others open", async () => {
      const answered = await seedQuote("Accepted");
      const waiting = await seedQuote("Sent");
      await createQuoteFollowUp(db.prisma, { quoteId: answered.quote.id });
      await createQuoteFollowUp(db.prisma, { quoteId: waiting.quote.id });
      await db.prisma.task.create({
        data: { customerId: waiting.customer.customerId, title: "Manuell", dueDate: new Date() },
      });

      expect(await closeAnsweredFollowUps(db.prisma)).toBe(1);

      const open = await db.prisma.task.findMany({ where: { doneAt: null }, orderBy: { id: "asc" } });
      expect(open.map((t) => t.quoteId)).toEqual([waiting.quote.id, null]);
    });
  });

  describe("notifyDueTasks", () => {
    const settings = {} as Parameters<typeof notifyDueTasks>[1];

    it("announces due open tasks once and stamps them", async () => {
      notifyAdmins.mockClear();
      const { customer } = await seedQuote();
      const now = new Date(2026, 9, 10);
      await db.prisma.task.createMany({
        data: [
          { customerId: customer.customerId, title: "fällig", dueDate: new Date(2026, 9, 9) },
          { customerId: customer.customerId, title: "später", dueDate: new Date(2026, 9, 20) },
          { customerId: customer.customerId, title: "erledigt", dueDate: new Date(2026, 9, 1), doneAt: now },
        ],
      });

      await notifyDueTasks(db.prisma, settings, now);
      await notifyDueTasks(db.prisma, settings, now);

      expect(notifyAdmins).toHaveBeenCalledTimes(1);
      expect(notifyAdmins.mock.calls[0][2]).toContain("1 Aufgabe");
      const stamped = await db.prisma.task.findMany({ where: { notifiedAt: { not: null } } });
      expect(stamped.map((t) => t.title)).toEqual(["fällig"]);
    });

    it("does nothing without settings", async () => {
      notifyAdmins.mockClear();
      await notifyDueTasks(db.prisma, null);
      expect(notifyAdmins).not.toHaveBeenCalled();
    });
  });

  describe("loadCustomerHistory", () => {
    it("merges documents, sends, payments, notes and tasks newest first", async () => {
      const { customer, quote } = await seedQuote();
      const invoice = await db.prisma.invoice.create({
        data: {
          customerId: customer.customerId,
          documentNumber: "I-1",
          date: new Date(2026, 0, 10),
          dueDate: new Date(2026, 1, 10),
          totalAmount: 200,
          state: "Sent",
        },
      });
      await db.prisma.invoiceSentLog.create({
        data: { invoiceId: invoice.id, sentAt: new Date(2026, 0, 11), sentTo: "a@b.ch", subject: "s" },
      });
      await db.prisma.payment.create({ data: { invoiceId: invoice.id, date: new Date(2026, 0, 20), amount: 200 } });
      await db.prisma.customerNote.create({
        data: { customerId: customer.customerId, title: "Anruf", content: "geheim", createdAt: new Date(2026, 0, 15) },
      });
      await db.prisma.quote.update({ where: { id: quote.id }, data: { date: new Date(2026, 0, 5) } });

      const events = await loadCustomerHistory(db.prisma, customer.customerId);

      expect(events.map((e) => e.kind)).toEqual(["payment", "note", "sent", "invoice", "quote"]);
      expect(events.map((e) => e.text).join("\n")).not.toContain("geheim");
      expect(events[0].href).toBe(`/invoices/${invoice.id}?from=customers/${customer.customerId}`);
    });

    it("leaves out quotes, quote sends and tasks of switched-off modules", async () => {
      const { customer, quote } = await seedQuote();
      await db.prisma.quoteSentLog.create({
        data: { quoteId: quote.id, sentAt: new Date(2026, 0, 6), sentTo: "a@b.ch", subject: "s" },
      });
      await db.prisma.task.create({
        data: { customerId: customer.customerId, title: "Anrufen", dueDate: new Date() },
      });
      await db.prisma.customerNote.create({
        data: { customerId: customer.customerId, title: "Notiz", content: "x" },
      });

      const all = await loadCustomerHistory(db.prisma, customer.customerId);
      expect(new Set(all.map((e) => e.kind))).toEqual(new Set(["quote", "sent", "task", "note"]));

      const off = await loadCustomerHistory(db.prisma, customer.customerId, { quotes: false, tasks: false });
      expect(off.map((e) => e.kind)).toEqual(["note"]);
    });

    it("only shows the customer's own data", async () => {
      const a = await seedQuote();
      await seedQuote();
      const events = await loadCustomerHistory(db.prisma, a.customer.customerId);
      expect(events).toHaveLength(1);
    });
  });
});
