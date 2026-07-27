/* eslint-disable @typescript-eslint/no-require-imports */
// Run: node generate-hash.js <your-password>
const { hashSync } = require("bcryptjs");
const password = process.argv[2];
if (!password) {
  console.error("Usage: node generate-hash.js <password>");
  process.exit(1);
}
console.log(hashSync(password, 10));
