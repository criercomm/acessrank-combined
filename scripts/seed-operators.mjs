#!/usr/bin/env node
import config from '../server/lib/config.js';
import { getStore } from '../server/lib/store.js';
import { createOperator, setOperatorClients, adminOverview, PortalError } from '../server/lib/portal.js';

/**
 * Create master operators (or plain operators) from the command line, so the
 * first team logins exist without anyone having to use the owner login.
 *
 *   node scripts/seed-operators.mjs "JP Lincoln <jp@example.com>" "Carlos <carlos@example.com>"
 *   node scripts/seed-operators.mjs --operator "Arturo <arturo@example.com>"
 *   node scripts/seed-operators.mjs --assign "Top Seedz" "JP Lincoln <jp@example.com>"
 *
 * --assign "Client name" (repeatable) also assigns that client to everyone
 * created in this run. Masters can already see every client; assignment is
 * what puts a client on their own list.
 *
 * Each person is created as a MASTER unless --operator comes first. A one-time
 * password is printed for each; it cannot be looked up later. Anyone who already
 * exists is left alone and reported.
 */

const args = process.argv.slice(2);
let role = 'master';
const assign = [];
for (let i = 0; i < args.length;) {
  if (args[i] === '--operator') { role = 'operator'; args.splice(i, 1); }
  else if (args[i] === '--assign') { assign.push(args[i + 1]); args.splice(i, 2); }
  else i++;
}

if (!args.length) {
  console.error('Usage: node scripts/seed-operators.mjs [--operator] "Name <email>" ...');
  process.exit(1);
}
if (!config.db.url) {
  console.error('DATABASE_URL is not set. Run this where the production database is reachable.');
  process.exit(1);
}

const store = await getStore();
try {
  await store.migrate();
  const wanted = [];
  if (assign.length) {
    const { clients } = await adminOverview(store, null);
    for (const name of assign) {
      const c = clients.find((x) => x.name.toLowerCase() === String(name).trim().toLowerCase());
      if (c) wanted.push(c.id); else { console.error(`No client named "${name}" — check the spelling in the Clients list.`); process.exitCode = 1; }
    }
  }
  for (const arg of args) {
    const m = /^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(arg);
    if (!m) { console.error(`Skipped "${arg}": write it as Name <email>.`); process.exitCode = 1; continue; }
    try {
      const { operator, password } = await createOperator(store, { name: m[1], email: m[2], role });
      if (wanted.length) await setOperatorClients(store, operator.id, wanted);
      console.log(`\n${operator.name} (${role})\n  email:    ${operator.email}\n  password: ${password}\n  Shown once. Send it privately; they can change it after signing in.`);
    } catch (err) {
      if (err instanceof PortalError) { console.error(`\nSkipped ${m[2]}: ${err.message}`); process.exitCode = 1; } else throw err;
    }
  }
} finally {
  if (store.close) await store.close();
}
