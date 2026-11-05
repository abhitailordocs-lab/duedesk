import { money, fmtDate, today, daysBetween, isOverdue, BASE } from './lib.js';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const css = `
:root{--ink:#16233a;--mute:#5b6778;--paper:#f2f4f7;--card:#fff;--line:#d8dee6;--brand:#0e6b5c;--warn:#9a5b00;--ok:#166534;--bad:#b42318}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
h1,h2,h3,.logo{font-family:"Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.02em;line-height:1.15;margin:0}
a{color:var(--brand)}main{max-width:980px;margin:0 auto;padding:24px 20px 80px}
header{background:var(--card);border-bottom:1px solid var(--line)}header div{max-width:980px;margin:0 auto;padding:14px 20px;display:flex;gap:20px;align-items:center}
.logo{font-size:22px;font-weight:700;color:var(--ink);text-decoration:none;margin-right:auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px;margin-top:16px}
.stats{display:flex;gap:28px;flex-wrap:wrap}.stats b{display:block;font:700 28px "Bricolage Grotesque",sans-serif}.stats span{color:var(--mute);font-size:14px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid var(--line);font-size:15px;vertical-align:top}th{color:var(--mute);font-weight:500;font-size:13px}
.wrap{overflow-x:auto}.chip{display:inline-block;padding:2px 9px;border-radius:99px;font-size:13px;font-weight:600;border:1px solid currentColor;white-space:nowrap}
.c-ok{color:var(--ok)}.c-bad{color:var(--bad)}.c-warn{color:var(--warn)}.c-brand{color:var(--brand)}
label{display:block;font-size:14px;color:var(--mute);margin:12px 0 4px}input,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff;color:var(--ink)}
textarea{min-height:130px;resize:vertical}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
button,.btn{font:600 15px system-ui;padding:9px 16px;border-radius:6px;border:1px solid var(--brand);background:var(--brand);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
button.alt,.btn.alt{background:#fff;color:var(--brand)}button.danger{background:#fff;color:var(--bad);border-color:var(--bad)}
:focus-visible{outline:3px solid #7cc4b8;outline-offset:2px}.bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.mute{color:var(--mute)}
.err{background:#fdecea;border:1px solid var(--bad);color:var(--bad);padding:10px 12px;border-radius:6px;margin-top:12px}.ok{background:#e8f5ee;border:1px solid var(--ok);color:var(--ok);padding:10px 12px;border-radius:6px;margin-top:12px}
code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:14px;background:#eef1f5;padding:2px 5px;border-radius:4px;word-break:break-all}
.url{display:block;padding:12px;margin:8px 0}.hero{padding:36px 0 8px}.hero h1{font-size:clamp(32px,6vw,52px)}.hero p{font-size:18px;color:var(--mute);max-width:620px}
@media(max-width:600px){main{padding:16px 14px 60px}}`;

export const page = (title, body, ws, flash = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | DueDesk</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<header><div><a class="logo" href="/">DueDesk</a>${ws ? `<a href="/connect">Connect Claude</a><a href="/settings">Settings</a><form method="post" action="/logout" style="margin:0"><button class="alt">Log out</button></form>` : ''}</div></header>
<main>${flash}${body}</main></body></html>`;
export const flashErr = m => m ? `<div class="err" role="alert">${esc(m)}</div>` : '';
export const flashOk = m => m ? `<div class="ok" role="status">${esc(m)}</div>` : '';

export function chip(i) {
  if (i.status === 'paid') return '<span class="chip c-ok">Paid</span>';
  const od = isOverdue(i) ? `Overdue ${daysBetween(i.due_date, today())}d` : null;
  if (i.status === 'draft') return `<span class="chip c-warn">${od ? od + ' · ' : ''}Needs approval</span>`;
  return od ? `<span class="chip c-bad">${od}</span>` : '<span class="chip c-brand">Reminders on</span>';
}

export function landing(err) {
  return page('Chase invoices from Claude', `
<section class="hero"><h1>Tell Claude to chase it.<br>DueDesk does the following up.</h1>
<p>Attach an invoice in Claude. It reads it and writes the reminders in your voice. DueDesk keeps them, lets you edit, and sends them on schedule, even when you are not in a chat.</p></section>
${flashErr(err)}
<div class="row"><form class="card" method="post" action="/signup"><h2>Create a workspace</h2>
<label for="n">Business or your name</label><input id="n" name="name" required><label for="e">Email</label><input id="e" name="email" type="email" required>
<label for="p">Password (8+ characters)</label><input id="p" name="password" type="password" minlength="8" required><div class="bar"><button>Create workspace</button></div></form>
<form class="card" method="post" action="/login"><h2>Log in</h2><label for="le">Email</label><input id="le" name="email" type="email" required>
<label for="lp">Password</label><input id="lp" name="password" type="password" required><div class="bar"><button>Log in</button></div></form></div>`);
}

export function dashboard(ws, rows, m, flash) {
  const body = `<h1>Receivables</h1>
<div class="card stats"><div><b>${money(m.outstanding)}</b><span>outstanding in ${m.open} invoices</span></div><div><b>${m.overdue}</b><span>overdue (${money(m.overdue_amount)})</span></div><div><b>${m.awaiting_approval}</b><span>waiting for your approval</span></div><div><b>${m.paid}</b><span>paid</span></div></div>
<div class="card wrap">${rows.length ? `<table><tr><th>Client</th><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th>Next reminder</th></tr>${rows.map(i =>
    `<tr><td><a href="/invoice/${i.id}"><b>${esc(i.client_name)}</b></a></td><td>${esc(i.invoice_no)}</td><td>${money(i.amount, i.currency)}</td><td>${fmtDate(i.due_date)}</td><td>${chip(i)}</td><td>${i.next_send && i.status !== 'paid' ? fmtDate(i.next_send) : '<span class="mute">None</span>'}</td></tr>`).join('')}</table>`
      : `<h3>No invoices yet</h3><p class="mute">Open Claude, attach an invoice and ask it to chase the payment. It will appear here for your approval.</p><a class="btn" href="/connect">Connect Claude</a>`}</div>`;
  return page('Receivables', body, ws, flash);
}

export function invoiceDetail(ws, inv, rems, acts, flash) {
  const link = `${BASE()}/i/${inv.public_id}`;
  const R = rems.map(r => `<div class="card"><div class="row"><div><label>Step</label><input name="l_${r.id}" value="${esc(r.label)}" ${r.status === 'sent' ? 'readonly' : ''}></div>
<div><label>Send on</label><input type="date" name="d_${r.id}" value="${r.send_on}" ${r.status === 'sent' ? 'readonly' : ''}></div><div><label>Status</label><p style="margin:6px 0"><b>${r.status === 'sent' ? 'Sent' : r.status === 'failed' ? 'Failed' : r.status === 'skipped' ? 'Skipped' : 'Waiting'}</b>${r.error ? `<br><span class="c-bad">${esc(r.error)}</span>` : ''}</p></div></div>
<label>Subject</label><input name="s_${r.id}" value="${esc(r.subject)}" ${r.status === 'sent' ? 'readonly' : ''}><label>Email text</label><textarea name="b_${r.id}" ${r.status === 'sent' ? 'readonly' : ''}>${esc(r.body)}</textarea>
${r.status !== 'sent' && inv.status !== 'paid' ? `<div class="bar"><button class="alt" formaction="/invoice/${inv.id}/send/${r.id}">Save and send now</button></div>` : ''}</div>`).join('');
  const body = `<p><a href="/">Back to receivables</a></p><h1>${esc(inv.invoice_no)} · ${esc(inv.client_name)}</h1><p>${chip(inv)} <span class="mute">${money(inv.amount, inv.currency)} due ${fmtDate(inv.due_date)}</span></p>
<form method="post" action="/invoice/${inv.id}"><div class="card"><div class="row"><div><label>Client name</label><input name="client_name" value="${esc(inv.client_name)}" required></div><div><label>Client email</label><input name="client_email" type="email" value="${esc(inv.client_email)}" required></div>
<div><label>Invoice number</label><input name="invoice_no" value="${esc(inv.invoice_no)}" required></div><div><label>Amount (${esc(inv.currency)})</label><input name="amount" type="number" step="0.01" min="0.01" value="${inv.amount}" required></div><div><label>Due date</label><input name="due_date" type="date" value="${inv.due_date}" required></div></div>
<label>Internal note (never shown to the client)</label><input name="notes" value="${esc(inv.notes)}"></div>
<h2 style="margin-top:28px">Reminder emails</h2>${R}
<div class="bar"><button>Save changes</button>${inv.status !== 'paid' ? (inv.status === 'scheduled' ? `<button class="alt" formaction="/invoice/${inv.id}/pause">Pause reminders</button>` : `<button formaction="/invoice/${inv.id}/approve">Approve and schedule</button>`) : ''}
${inv.status !== 'paid' ? `<button class="danger" formaction="/invoice/${inv.id}/paid">Mark as paid</button>` : ''}</div></form>
<div class="card"><h3>Client page</h3><p class="mute">Your client sees this page from the link in every reminder. They can mark the invoice as paid there.</p><a class="mono" href="${link}" target="_blank" rel="noopener">${link}</a></div>
<div class="card"><h3>Activity</h3>${acts.length ? `<table>${acts.map(a => `<tr><td class="mute" style="white-space:nowrap">${new Date(a.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(a.text)}</td></tr>`).join('')}</table>` : '<p class="mute">Nothing yet.</p>'}</div>`;
  return page(inv.invoice_no, body, ws, flash);
}

export function connect(ws) {
  const url = `${BASE()}/mcp/${ws.token}`;
  return page('Connect Claude', `<h1>Connect Claude to DueDesk</h1><p class="mute">Takes about a minute. Works with any Claude plan that supports custom connectors.</p>
<div class="card"><h3>Your private connector URL</h3><span class="mono url">${esc(url)}</span><p class="mute">Treat this like a password. Anyone with the URL can add invoices to your workspace.</p></div>
<div class="card"><h3>Steps</h3><ol><li>In Claude, open <b>Settings</b> and go to <b>Connectors</b>. Menu names change, so look for the option to add a custom connector.</li><li>Choose <b>Add custom connector</b>, name it <b>DueDesk</b>, and paste the URL above. Leave any OAuth fields empty.</li><li>Start a new chat and make sure DueDesk is switched on for it.</li><li>Attach an invoice (PDF or photo) and paste the test prompt below.</li></ol></div>
<div class="card"><h3>Test prompt</h3><p class="mono" style="display:block;padding:12px">Here is my invoice. Set it up in DueDesk with 4 reminders: a friendly one 3 days before the due date, one on the due date, a polite follow-up 4 days after, and a firm one 10 days after. Keep my tone warm but direct, and sign off as ${esc(ws.name)}.</p>
<p class="mute">Then open the <a href="/">dashboard</a>, edit the emails, and press Approve and schedule.</p></div>`, ws);
}

export function settings(ws, flash) {
  return page('Settings', `<h1>Settings</h1><form class="card" method="post" action="/settings"><label>Business name (used as the email sender name)</label><input name="name" value="${esc(ws.name)}" required>
<label>Payment details shown on the client page</label><textarea name="pay_info">${esc(ws.pay_info)}</textarea><div class="bar"><button>Save settings</button></div></form>`, ws, flash);
}

export function publicInvoice(inv, ws) {
  const paid = inv.status === 'paid';
  return page(`Invoice ${inv.invoice_no}`, `<h1>Invoice ${esc(inv.invoice_no)}</h1><p class="mute">From ${esc(ws.name)} to ${esc(inv.client_name)}</p>
<div class="card stats"><div><b>${money(inv.amount, inv.currency)}</b><span>amount</span></div><div><b>${fmtDate(inv.due_date)}</b><span>due date</span></div></div>
<div class="card"><h3>How to pay</h3><p style="white-space:pre-wrap">${esc(ws.pay_info)}</p></div>
${paid ? `<div class="ok" role="status">Marked as paid on ${fmtDate(new Date(inv.paid_at).toISOString().slice(0, 10))}. Thank you.</div>` : `<form method="post" action="/i/${inv.public_id}/paid" class="bar"><button>I've paid this invoice</button></form><p class="mute">This tells ${esc(ws.name)} you have paid and stops further reminders.</p>`}`, null);
}
