// End-to-end smoke test: MCP tools -> dashboard -> edit -> approve -> send -> client marks paid.
// Run: DATABASE_URL=... npm test   (uses dry-run email unless RESEND_API_KEY is set)
process.env.PORT ||= '3111'; process.env.BASE_URL ||= `http://localhost:${process.env.PORT}`;
process.env.DEMO_EMAIL = 'test@duedesk.test'; process.env.DEMO_PASSWORD = 'testpass123'; process.env.DEMO_TOKEN = 'testtoken'; process.env.RESEND_API_KEY = '';
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { server } = await import('./server.js');
const B = process.env.BASE_URL; let fails = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };

const c = new Client({ name: 'test', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${B}/mcp/testtoken`)));
const tools = (await c.listTools()).tools.map(t => t.name);
ok(tools.length === 5, 'MCP lists 5 tools: ' + tools.join(', '));
const call = async (name, args) => (await c.callTool({ name, arguments: args })).content[0].text;
const r1 = await call('create_invoice', { client_name: 'Priya Nair', client_email: 'test@duedesk.test', amount: 42000, due_date: '2030-01-10', invoice_no: 'T-100',
  reminders: [{ label: 'Nudge', days_from_due: -3, subject: 'Invoice T-100', body: 'Hi Priya,\nQuick nudge.\nAbhi' }] });
ok(/Saved invoice T-100/.test(r1), 'create_invoice: ' + r1.slice(0, 60));
ok(/already exists/.test(await call('create_invoice', { client_name: 'x', client_email: 'a@b.co', amount: 1, due_date: '2030-01-10', invoice_no: 'T-100' })), 'duplicate rejected');
ok(/T-100/.test(await call('list_invoices', {})), 'list_invoices');
ok(/Outstanding/.test(await call('get_summary', {})), 'get_summary');

const bad = await fetch(`${B}/mcp/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok(bad.status === 401, 'bad token rejected');

// web app as the human
const login = await fetch(`${B}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=test@duedesk.test&password=testpass123' });
const cookie = login.headers.get('set-cookie').split(';')[0];
const get = p => fetch(B + p, { headers: { cookie } }).then(r => r.text());
const post = (p, body) => fetch(B + p, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
ok((await get('/')).includes('Priya Nair'), 'dashboard shows Claude-created invoice');
const id = /\/invoice\/(\d+)"><b>Priya/.exec(await get('/'))[1];
let d = await get(`/invoice/${id}`);
const rid = /name="s_(\d+)"/.exec(d)[1];
const f = { client_name: 'Priya Nair', client_email: 'test@duedesk.test', invoice_no: 'T-100', amount: '42000', due_date: '2030-01-10', notes: '' };
await post(`/invoice/${id}`, { ...f, [`l_${rid}`]: 'Nudge', [`d_${rid}`]: '2030-01-07', [`s_${rid}`]: 'EDITED SUBJECT', [`b_${rid}`]: 'Edited body' });
d = await get(`/invoice/${id}`); ok(d.includes('EDITED SUBJECT'), 'human edit persisted');
await post(`/invoice/${id}/approve`, { ...f, [`l_${rid}`]: 'Nudge', [`d_${rid}`]: '2030-01-07', [`s_${rid}`]: 'EDITED SUBJECT', [`b_${rid}`]: 'Edited body' });
ok((await get(`/invoice/${id}`)).includes('Reminders on'), 'approve -> scheduled');
await post(`/invoice/${id}/send/${rid}`, { ...f, [`l_${rid}`]: 'Nudge', [`d_${rid}`]: '2030-01-07', [`s_${rid}`]: 'EDITED SUBJECT', [`b_${rid}`]: 'Edited body' });
ok(/dry run/.test(await get(`/invoice/${id}`)), 'send now logged (dry run)');
const pid = /\/i\/([\w-]+)/.exec(await get(`/invoice/${id}`))[1];
ok((await fetch(`${B}/i/${pid}`).then(r => r.text())).includes('42,000'), 'public client page renders');
await fetch(`${B}/i/${pid}/paid`, { method: 'POST', redirect: 'manual' });
ok(/Paid/.test(await get('/')), 'client marked paid -> dashboard shows Paid');
ok(!(await get('/')).includes('undefined'), 'no "undefined" leaks in HTML');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); server.close(); process.exit(fails ? 1 : 0);
