import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { one, q } from './db.js';
import * as L from './lib.js';

const reminder = z.object({
  label: z.string().describe('Short name for this step, e.g. "Friendly heads-up"'),
  days_from_due: z.number().int().describe('Days relative to the due date. -3 = three days before, 0 = on the due date, 7 = a week after'),
  subject: z.string(),
  body: z.string().describe('Plain-text email in the user\'s voice, ending with their sign-off. Do NOT add the invoice link; DueDesk appends it.'),
});
const text = t => ({ content: [{ type: 'text', text: t }] });
const fail = t => ({ content: [{ type: 'text', text: t }], isError: true });
const line = i => `${i.invoice_no} | ${i.client_name} | ${L.money(i.amount, i.currency)} | due ${i.due_date} | ${L.isOverdue(i) ? `OVERDUE ${L.daysBetween(i.due_date, L.today())}d, ` : ''}${i.status}`;

export function buildMcp(ws) {
  const s = new McpServer({ name: 'duedesk', version: '1.0.0' });
  const find = no => one('select * from invoices where ws_id=$1 and invoice_no=$2', [ws.id, no]);

  s.registerTool('create_invoice', {
    title: 'Create invoice and reminder plan',
    description: 'Save an unpaid invoice in DueDesk with a schedule of payment-reminder emails. Read the invoice the user attached, extract the details, and write 3 to 4 reminder emails (friendly before due, firm after) in the user\'s tone. DueDesk will NOT send anything until the user approves it in the dashboard. Dates are YYYY-MM-DD.',
    inputSchema: {
      client_name: z.string(), client_email: z.string().email(), amount: z.number().positive(),
      currency: z.string().optional().describe('ISO code, default INR'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), invoice_no: z.string(),
      notes: z.string().optional().describe('Internal note, never shown to the client'),
      reminders: z.array(reminder).max(8).optional().describe('Omit to use default templates'),
    },
  }, async a => {
    try {
      const inv = await L.createInvoice(ws, a);
      return text(`Saved invoice ${inv.invoice_no} for ${inv.client_name} (${L.money(inv.amount, inv.currency)}, due ${inv.due_date}). Status: draft. Nothing has been sent. The user must review and approve it here: ${L.BASE()}/invoice/${inv.id}`);
    } catch (e) { return fail(e.message); }
  });

  s.registerTool('list_invoices', {
    title: 'List invoices', description: 'List invoices with status, optionally filtered. Status is one of draft (needs approval or paused), scheduled, paid.',
    inputSchema: { status: z.enum(['draft', 'scheduled', 'paid']).optional() },
  }, async ({ status }) => {
    const rows = await L.listInvoices(ws.id, status);
    return text(rows.length ? rows.map(line).join('\n') : 'No invoices found.');
  });

  s.registerTool('update_reminder_plan', {
    title: 'Change reminders or due date',
    description: 'Replace the unsent reminders and/or change the due date of an invoice. Already-sent reminders are kept. The invoice goes back to draft so the user must approve the new plan.',
    inputSchema: { invoice_no: z.string(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reminders: z.array(reminder).max(8).optional() },
  }, async ({ invoice_no, due_date, reminders }) => {
    let inv = await find(invoice_no); if (!inv) return fail(`No invoice ${invoice_no}.`);
    if (inv.status === 'paid') return fail('That invoice is already paid.');
    if (due_date) inv = await one('update invoices set due_date=$2 where id=$1 returning *', [inv.id, due_date]);
    await L.setReminders(inv, reminders?.length ? reminders : L.defaultReminders(inv, ws));
    await q(`update invoices set status='draft' where id=$1`, [inv.id]);
    await L.log(ws.id, inv.id, 'Reminder plan changed from Claude. Waiting for your approval.');
    return text(`Updated ${invoice_no}. It is back in draft until the user approves: ${L.BASE()}/invoice/${inv.id}`);
  });

  s.registerTool('mark_paid', {
    title: 'Mark invoice paid', description: 'Mark an invoice as paid and cancel its remaining reminders.',
    inputSchema: { invoice_no: z.string() },
  }, async ({ invoice_no }) => {
    const inv = await find(invoice_no); if (!inv) return fail(`No invoice ${invoice_no}.`);
    await L.markPaid(inv, 'the owner via Claude');
    return text(`${invoice_no} is marked paid. Remaining reminders cancelled.`);
  });

  s.registerTool('get_summary', {
    title: 'Receivables summary', description: 'Totals for outstanding, overdue and awaiting-approval invoices, and what is sent next.', inputSchema: {},
  }, async () => {
    const m = await L.summary(ws.id);
    return text(`Outstanding: ${L.money(m.outstanding)} across ${m.open} invoices. Overdue: ${m.overdue} (${L.money(m.overdue_amount)}). Awaiting your approval: ${m.awaiting_approval}. Paid: ${m.paid}. ` +
      (m.next ? `Next reminder: ${m.next.next_send} for ${m.next.invoice_no} (${m.next.client_name}).` : 'No reminders queued.') + ` Dashboard: ${L.BASE()}/`);
  });
  return s;
}
