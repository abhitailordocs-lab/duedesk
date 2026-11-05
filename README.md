# DueDesk

Tell Claude to chase an invoice. DueDesk keeps it, lets a human edit it, and sends the reminders on schedule.

**There is no AI inside this app.** No AI SDKs, no API keys, no model calls. Claude (on the customer's own plan) reads the invoice and writes the emails, then passes plain text to DueDesk through MCP. DueDesk stores it, shows it, edits it, schedules it, sends it. Hosting and email are the only costs.

## What Claude does vs what DueDesk does
| Claude | DueDesk |
|---|---|
| Reads the invoice PDF/photo, extracts fields | Stores invoices, per-workspace |
| Writes 3-4 reminder emails in the user's tone | Lets a person edit every email and date |
| | Waits for human approval, then sends on schedule (even when no chat is open) |
| | Hosts a client page with an "I've paid" button that stops reminders |

## MCP tools
`create_invoice`, `list_invoices`, `update_reminder_plan`, `mark_paid`, `get_summary`.
Anything Claude creates or changes is a **draft**; nothing is emailed until a human approves it in the dashboard.

## Connect to Claude
1. Sign up at the live app. You land on **Connect Claude** with your private URL: `https://<app>/mcp/<your-token>`.
2. Claude > Settings > Connectors > Add custom connector. Paste the URL. Leave OAuth blank.
3. New chat, switch DueDesk on, attach an invoice, paste the test prompt from the Connect page.
4. Open the dashboard, edit the emails, press **Approve and schedule**, or **Save and send now** on a reminder.

## Run locally
```
npm install
cp .env.example .env     # fill DATABASE_URL, BASE_URL, SESSION_SECRET
set -a; . ./.env; set +a; npm start
npm test                 # end-to-end smoke test (needs DATABASE_URL)
```
Requires Node 20+ and Postgres. With no `RESEND_API_KEY`, sends are logged as dry runs.

## Deploy
Any Node host with Postgres. Set the env vars from `.env.example`, start command `npm start`. The server runs its own scheduler every 5 minutes (sends due reminders after 9am IST). If the host sleeps on idle, ping `GET /api/cron?key=$CRON_KEY` every 10 minutes from a free cron service.

## Safety
- Human approval before anything is sent.
- `ALLOWED_RECIPIENTS` restricts who can receive email (use it for demos).
- Claude edits send an invoice back to draft.
- The connector URL is a secret per workspace. OAuth is the next step for production.

## Cost per customer
One shared Postgres and one small server. A typical customer sends about 60 emails a month. Email is a fraction of a rupee each, so cost per customer is a few rupees a month.
