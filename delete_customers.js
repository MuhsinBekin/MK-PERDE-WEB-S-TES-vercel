const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname,'data.db'));

const customers = db.prepare("SELECT id, username FROM users WHERE role = 'customer'").all();
if (!customers.length) {
  console.log('No customer accounts found.');
  process.exit(0);
}

console.log('Found customers:', customers.map(c=>c.username));

const ids = customers.map(c=>c.id);
const delTokens = db.prepare('DELETE FROM tokens WHERE user_id = ?');
const delUser = db.prepare('DELETE FROM users WHERE id = ?');

let tokenDeletes = 0, userDeletes = 0;
for (const id of ids) {
  const t = delTokens.run(id);
  tokenDeletes += t.changes;
  const u = delUser.run(id);
  userDeletes += u.changes;
}
console.log(`Deleted ${userDeletes} users and ${tokenDeletes} tokens.`);

console.log('Remaining users:');
const rows = db.prepare('SELECT id, username, name, phone, role FROM users').all();
console.log(rows);
