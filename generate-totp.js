/* eslint-disable @typescript-eslint/no-require-imports */
// Run: node generate-totp.js
// Outputs a base32 secret and QR code URL for Google Authenticator / Authy
const { OTP } = require("otplib");
const otp = new OTP({ strategy: "totp" });
const secret = otp.generateSecret();
const uri = otp.generateURI({
  issuer: "CustomerManagement",
  label: "admin",
  secret,
});

console.log("TOTP_SECRET=" + secret);
console.log("\nQR code URL (paste into browser or any QR generator):");
console.log("https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(uri));
console.log("\nManual entry key:", secret);
