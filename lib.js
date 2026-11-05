import crypto from 'node:crypto';
import { q, one } from './db.js';

export const BASE = () => (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const istHour = () => parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }), 10) % 24;
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
export const money = (n, c = 'INR') => new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
export const fmtDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const log = (ws_id, invoice_id, text) => q('insert into activity(ws_id,invoice_id,text) values($1,$2,$3)', [ws_id, invoice_id, text]);

// ---------- passwords & sessions ----------
export const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
export const checkPw = (pw, h) => { const [s, k] = h.split(':'); const a = Buffer.from(k, 'hex'), b = crypto.scryptSync(pw, s, 32); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const SECRET = () => process.env.SESSION_SECRET || 'dev-only-secret';
const sign = v => crypto.createHmac('sha256', SECRET()).update(v).digest('base64url');
export function setSession(res, wsId) {
  const v = `${wsId}.${Date.now() + 7 * 864e5}`;
  res.setHeader('Set-Cookie', `dd=${v}.${sign(v)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
export const clearSession = res => res.setHeader('Set-Cookie', 'dd=; HttpOnly; Path=/; Max-Age=0');
export async function sessionWs(req) {
  const m = /(?:^|;\s*)dd=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const [id, exp, sig] = m[1].split('.');
  if (!sig || sign(`${id}.${exp}`) !== sig || Date.now() > +exp) return null;
  return one('select * from workspaces where id=$1', [id]);
}
export async function createWorkspace(name, email, password, token) {
  return one('insert into workspaces(name,email,pass_hash,token,pay_info) values($1,$2,$3,$4,$5) returning *',
    [name, email.toLowerCase(), hashPw(password), token || crypto.randomBytes(24).toString('hex'), 'Pay by UPI or bank transfer.\nAdd your UPI ID / bank details in Settings.']);
}

// ---------- default reminder copy (used only if Claude sends none) ----------
export function defaultReminders(inv, ws) {
  const first = inv.client_name.split(' ')[0], no = inv.invoice_no, amt = money(inv.amount, inv.currency), due = fmtDate(inv.due_date);
  return [
    { label: 'Friendly heads-up', days_from_due: -3, subject: `Invoice ${no} is due on ${due}`, body: `Hi ${first},\n\nA quick heads-up that invoice ${no} for ${amt} is due on ${due}.\n\nThank you,\n${ws.name}` },
    { label: 'Due today', days_from_due: 0, subject: `Invoice ${no} is due today`, body: `Hi ${first},\n\nInvoice ${no} for ${amt} is due today. If it's already on its way, thank you.\n\nBest,\n${ws.name}` },
    { label: 'Gentle follow-up', days_from_due: 4, subject: `Following up on invoice ${no}`, body: `Hi ${first},\n\nInvoice ${no} for ${amt} was due on ${due} and I haven't seen the payment yet. Could you let me know when to expect it?\n\nThanks,\n${ws.name}` },
    { label: 'Firm reminder', days_from_due: 10, subject: `Overdue: invoice ${no}`, body: `Hi ${first},\n\nInvoice ${no} for ${amt} is now overdue. Please arrange payment this week, or tell me if there is an issue I can help resolve.\n\nRegards,\n${ws.name}` },
  ];
}

// ---------- invoice operations ----------
export async function setReminders(inv, list) {
  await q(`delete from reminders where invoice_id=$1 and status in ('pending','failed','skipped')`, [inv.id]);
  for (const r of list) await q('insert into reminders(invoice_id,label,send_on,subject,body) values($1,$2,$3,$4,$5)',
    [inv.id, r.label, addDays(inv.due_date, r.days_from_due), r.subject, r.body]);
}
export async function createInvoice(ws, a) {
  if (await one('select id from invoices where ws_id=$1 and invoice_no=$2', [ws.id, a.invoice_no]))
    throw new Error(`Invoice ${a.invoice_no} already exists. Use update_reminder_plan to change it.`);
  const inv = await one(`insert into invoices(ws_id,public_id,invoice_no,client_name,client_email,amount,currency,due_date,notes)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [ws.id, crypto.randomBytes(9).toString('base64url'), a.invoice_no, a.client_name, a.client_email, a.amount, a.currency || 'INR', a.due_date, a.notes || '']);
  await setReminders(inv, a.reminders?.length ? a.reminders : defaultReminders(inv, ws));
  await log(ws.id, inv.id, 'Created from Claude. Waiting for your approval.');
  return inv;
}
export async function approve(inv) {
  const t = today();
  const past = await q(`select id from reminders where invoice_id=$1 and status='pending' and send_on<$2 order by send_on`, [inv.id, t]);
  for (let i = 0; i < past.length; i++)
    await q(i === past.length - 1 ? 'update reminders set send_on=$2 where id=$1' : `update reminders set status='skipped' where id=$1`, [past[i].id, t]);
  await q(`update invoices set status='scheduled' where id=$1`, [inv.id]);
  await log(inv.ws_id, inv.id, 'Approved. Reminders are scheduled.');
}
export async function pause(inv) { await q(`update invoices set status='draft' where id=$1 and status<>'paid'`, [inv.id]); await log(inv.ws_id, inv.id, 'Reminders paused.'); }
export async function markPaid(inv, by) {
  await q(`update invoices set status='paid',paid_at=now(),paid_by=$2 where id=$1`, [inv.id, by]);
  await q(`update reminders set status='skipped' where invoice_id=$1 and status in ('pending','failed')`, [inv.id]);
  await log(inv.ws_id, inv.id, `Marked as paid by ${by}. Remaining reminders cancelled.`);
}

// ---------- email (no AI: just sends stored text) ----------
async function sendEmail({ to, subject, text, fromName, replyTo }) {
  const allow = (process.env.ALLOWED_RECIPIENTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(to.toLowerCase())) throw new Error('Blocked: recipient is not on the demo allow-list');
  if (!process.env.RESEND_API_KEY) return { dry: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${process.env.EMAIL_FROM || 'onboarding@resend.dev'}>`, to: [to], subject, text, reply_to: replyTo }),
  });
  if (!r.ok) throw new Error(`Email provider error ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return {};
}
export async function sendReminder(rid) {
  const [c] = await q(`update reminders set status='sending' where id=$1 and status in ('pending','failed') returning *`, [rid]);
  if (!c) return { ok: false, error: 'Already sent or in progress' };
  const inv = await one('select * from invoices where id=$1', [c.invoice_id]);
  const ws = await one('select * from workspaces where id=$1', [inv.ws_id]);
  try {
    const r = await sendEmail({ to: inv.client_email, subject: c.subject, fromName: ws.name, replyTo: ws.email,
      text: `${c.body}\n\n--\nView the invoice and payment details: ${BASE()}/i/${inv.public_id}` });
    await q(`update reminders set status='sent',sent_at=now(),error=null where id=$1`, [rid]);
    await log(ws.id, inv.id, `${r.dry ? '[dry run, no email key set] ' : ''}Sent "${c.label}" to ${inv.client_email}`);
    return { ok: true, dry: !!r.dry };
  } catch (e) {
    await q(`update reminders set status='failed',error=$2 where id=$1`, [rid, String(e.message).slice(0, 300)]);
    await log(ws.id, inv.id, `Could not send "${c.label}": ${e.message}`);
    return { ok: false, error: e.message };
  }
}
export async function processDue(force = false) {
  if (!force && istHour() < 9) return 0;
  const rows = await q(`select r.id from reminders r join invoices i on i.id=r.invoice_id
    where r.status='pending' and i.status='scheduled' and r.send_on<=$1 order by r.send_on`, [today()]);
  for (const r of rows) await sendReminder(r.id);
  return rows.length;
}

// ---------- reads ----------
export const listInvoices = (wsId, status) => q(`select i.*, (select min(send_on) from reminders r where r.invoice_id=i.id and r.status='pending') as next_send
  from invoices i where ws_id=$1 ${status ? 'and status=$2' : ''} order by due_date`, status ? [wsId, status] : [wsId]);
export const isOverdue = i => i.status !== 'paid' && i.due_date < today();
export async function summary(wsId) {
  const all = await listInvoices(wsId);
  const open = all.filter(i => i.status !== 'paid');
  const overdue = open.filter(isOverdue);
  const sum = a => a.reduce((s, i) => s + i.amount, 0);
  return { total: all.length, open: open.length, outstanding: sum(open), overdue: overdue.length, overdue_amount: sum(overdue),
    awaiting_approval: open.filter(i => i.status === 'draft').length, paid: all.length - open.length, next: open.filter(i => i.next_send).sort((a, b) => a.next_send.localeCompare(b.next_send))[0] || null };
}
