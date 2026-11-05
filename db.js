import pg from 'pg';
pg.types.setTypeParser(1082, v => v);          // DATE -> 'YYYY-MM-DD'
pg.types.setTypeParser(1700, v => parseFloat(v)); // NUMERIC -> number
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export const q = (t, p = []) => pool.query(t, p).then(r => r.rows);
export const one = (t, p = []) => q(t, p).then(r => r[0] || null);

export async function migrate() {
  await pool.query(`
  create table if not exists workspaces(
    id serial primary key, name text not null, email text unique not null,
    pass_hash text not null, token text unique not null,
    pay_info text not null default '', created_at timestamptz default now());
  create table if not exists invoices(
    id serial primary key, ws_id int not null references workspaces(id),
    public_id text unique not null, invoice_no text not null,
    client_name text not null, client_email text not null,
    amount numeric not null, currency text not null default 'INR',
    due_date date not null, status text not null default 'draft',
    notes text not null default '', created_at timestamptz default now(),
    paid_at timestamptz, paid_by text, unique(ws_id, invoice_no));
  create table if not exists reminders(
    id serial primary key, invoice_id int not null references invoices(id) on delete cascade,
    label text not null, send_on date not null, subject text not null, body text not null,
    status text not null default 'pending', sent_at timestamptz, error text);
  create table if not exists activity(
    id serial primary key, ws_id int not null, invoice_id int,
    text text not null, at timestamptz default now());
  `);
}
