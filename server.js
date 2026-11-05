import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { migrate, q, one } from './db.js';
import * as L from './lib.js';
import * as V from './views.js';
import { buildMcp } from './mcp.js';

const app = express();
app.set('trust proxy', 1);
const form = express.urlencoded({ extended: false, limit: '200kb' });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const need = wrap(async (req, res, next) => { req.ws = await L.sessionWs(req); req.ws ? next() : res.redirect('/'); });
const mine = async (req) => one('select * from invoices where id=$1 and ws_id=$2', [+req.params.id || 0, req.ws.id]);
const go = (res, path, k, v) => res.redirect(v ? `${path}?${k}=${encodeURIComponent(v)}` : path);

app.get('/health', (_, res) => res.json({ ok: true }));

// ---------- MCP (stateless streamable HTTP). No AI here: just tools that read/write the database. ----------
app.post('/mcp/:token', express.json({ limit: '1mb' }), wrap(async (req, res) => {
  const ws = await one('select * from workspaces where token=$1', [req.params.token]);
  if (!ws) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown connector URL. Copy it again from DueDesk > Connect Claude.' }, id: null });
  const server = buildMcp(ws);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}));
app.all('/mcp/:token', (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null }));

// ---------- auth ----------
app.get('/', wrap(async (req, res) => {
  const ws = await L.sessionWs(req);
  if (!ws) return res.send(V.landing(req.query.err));
  res.send(V.dashboard(ws, await L.listInvoices(ws.id), await L.summary(ws.id), V.flashOk(req.query.ok) + V.flashErr(req.query.err)));
}));
app.post('/signup', form, wrap(async (req, res) => {
  const { name = '', email = '', password = '' } = req.body;
  if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return go(res, '/', 'err', 'Enter a name, a valid email and a password of 8+ characters.');
  if (await one('select 1 from workspaces where email=$1', [email.toLowerCase()])) return go(res, '/', 'err', 'That email already has a workspace. Log in instead.');
  const ws = await L.createWorkspace(name.trim(), email.trim(), password);
  L.setSession(res, ws.id); res.redirect('/connect');
}));
app.post('/login', form, wrap(async (req, res) => {
  const ws = await one('select * from workspaces where email=$1', [(req.body.email || '').toLowerCase()]);
  if (!ws || !L.checkPw(req.body.password || '', ws.pass_hash)) return go(res, '/', 'err', 'Email or password is wrong.');
  L.setSession(res, ws.id); res.redirect('/');
}));
app.post('/logout', (req, res) => { L.clearSession(res); res.redirect('/'); });

// ---------- app pages ----------
app.get('/connect', need, (req, res) => res.send(V.connect(req.ws)));
app.get('/settings', need, (req, res) => res.send(V.settings(req.ws, V.flashOk(req.query.ok))));
app.post('/settings', need, form, wrap(async (req, res) => {
  await q('update workspaces set name=$2, pay_info=$3 where id=$1', [req.ws.id, (req.body.name || req.ws.name).trim().slice(0, 80), (req.body.pay_info || '').slice(0, 1000)]);
  go(res, '/settings', 'ok', 'Settings saved.');
}));

app.get('/invoice/:id', need, wrap(async (req, res) => {
  const inv = await mine(req); if (!inv) return res.status(404).send(V.page('Not found', '<h1>Invoice not found</h1>', req.ws));
  const rems = await q('select * from reminders where invoice_id=$1 order by send_on, id', [inv.id]);
  const acts = await q('select * from activity where invoice_id=$1 order by at desc limit 30', [inv.id]);
  res.send(V.invoiceDetail(req.ws, inv, rems, acts, V.flashOk(req.query.ok) + V.flashErr(req.query.err)));
}));

async function save(req, inv) {   // returns error text or null
  const b = req.body, date = /^\d{4}-\d{2}-\d{2}$/;
  if (!b.client_name?.trim() || !/^\S+@\S+\.\S+$/.test(b.client_email || '') || !(+b.amount > 0) || !date.test(b.due_date || '') || !b.invoice_no?.trim()) return 'Check the invoice fields: name, a valid email, an amount above 0, a due date and an invoice number are required.';
  try {
    await q('update invoices set client_name=$2,client_email=$3,amount=$4,due_date=$5,invoice_no=$6,notes=$7 where id=$1',
      [inv.id, b.client_name.trim(), b.client_email.trim(), +b.amount, b.due_date, b.invoice_no.trim(), (b.notes || '').slice(0, 500)]);
  } catch (e) { return 'That invoice number is already used by another invoice.'; }
  for (const r of await q(`select id from reminders where invoice_id=$1 and status<>'sent'`, [inv.id])) {
    if (!date.test(b[`d_${r.id}`] || '')) return 'Every reminder needs a valid send date.';
    await q('update reminders set label=$2,send_on=$3,subject=$4,body=$5 where id=$1', [r.id, b[`l_${r.id}`] || 'Reminder', b[`d_${r.id}`], b[`s_${r.id}`] || '(no subject)', b[`b_${r.id}`] || '']);
  }
  return null;
}
const act = (fn, msg) => [need, form, wrap(async (req, res) => {
  let inv = await mine(req); if (!inv) return res.redirect('/');
  const e = await save(req, inv); if (e) return go(res, `/invoice/${inv.id}`, 'err', e);
  inv = await mine(req); const out = fn ? await fn(inv, req) : null;
  go(res, `/invoice/${inv.id}`, out?.ok === false ? 'err' : 'ok', out?.ok === false ? out.error : (out?.msg || msg));
})];
app.post('/invoice/:id', ...act(null, 'Changes saved.'));
app.post('/invoice/:id/approve', ...act(async inv => { await L.approve(inv); }, 'Approved. Reminders will go out on their send dates, from 9am IST.'));
app.post('/invoice/:id/pause', ...act(async inv => { await L.pause(inv); }, 'Reminders paused.'));
app.post('/invoice/:id/paid', ...act(async inv => { await L.markPaid(inv, 'you'); }, 'Marked as paid. Remaining reminders cancelled.'));
app.post('/invoice/:id/send/:rid', ...act(async (inv, req) => {
  const r = await L.sendReminder(+req.params.rid); if (!r.ok) return r;
  return { msg: r.dry ? 'Marked as sent (dry run: no email key is set on this server).' : 'Email sent.' };
}));

// ---------- client-facing page ----------
const pub = async pid => { const inv = await one('select * from invoices where public_id=$1', [pid]); return inv && [inv, await one('select * from workspaces where id=$1', [inv.ws_id])]; };
app.get('/i/:pid', wrap(async (req, res) => { const p = await pub(req.params.pid); p ? res.send(V.publicInvoice(...p)) : res.status(404).send(V.page('Not found', '<h1>Invoice not found</h1>')); }));
app.post('/i/:pid/paid', wrap(async (req, res) => {
  const p = await pub(req.params.pid); if (!p) return res.status(404).end();
  if (p[0].status !== 'paid') await L.markPaid(p[0], 'the client');
  res.redirect(`/i/${req.params.pid}`);
}));

// ---------- scheduler ----------
app.get('/api/cron', wrap(async (req, res) => {
  if (!process.env.CRON_KEY || req.query.key !== process.env.CRON_KEY) return res.status(401).json({ error: 'bad key' });
  res.json({ processed: await L.processDue(req.query.force === '1') });
}));

app.use((err, req, res, next) => { console.error(err); res.status(500).send(V.page('Error', '<h1>Something went wrong</h1><p>Please try again.</p>')); });

// ---------- boot ----------
async function seedDemo() {
  const { DEMO_EMAIL, DEMO_PASSWORD, DEMO_TOKEN } = process.env;
  if (!DEMO_EMAIL || !DEMO_PASSWORD || await one('select 1 from workspaces where email=$1', [DEMO_EMAIL.toLowerCase()])) return;
  const ws = await L.createWorkspace('Demo Studio', DEMO_EMAIL, DEMO_PASSWORD, DEMO_TOKEN);
  await L.createInvoice(ws, { client_name: 'Acme Studios', client_email: DEMO_EMAIL, amount: 85000, due_date: L.addDays(L.today(), -2), invoice_no: 'DEMO-001', notes: 'Sample invoice' });
  console.log('Seeded demo workspace');
}
const port = process.env.PORT || 3000;
await migrate(); await seedDemo();
export const server = app.listen(port, () => console.log(`DueDesk on ${L.BASE()} (port ${port})`));
setInterval(() => L.processDue().catch(e => console.error('scheduler', e)), 5 * 60 * 1000);
