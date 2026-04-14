// Hash an admin password for ADMIN_PASSWORD_HASH.
// Usage: node scripts/hash-password.js 'my new password'
const bcrypt = require('bcryptjs');
const pw = process.argv[2];
if (!pw) {
  console.error("Usage: node scripts/hash-password.js '<password>'");
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 12);
console.log(hash);
