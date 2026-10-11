// Renders the PWA icons (a clock on the primary color) with sharp. The glyph stays inside the
// central 60 % so the same files also work as maskable icons. Run: npm run pwa:icons
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BACKGROUND = "#4f46e5";

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#fff" stroke-width="28"/>
  <path d="M256 170v92l62 36" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const outputs = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/apple-touch-icon.png", 180],
];

await mkdir("public/icons", { recursive: true });
for (const [file, size] of outputs) {
  await sharp(Buffer.from(svg(size))).png().toFile(file);
  console.log(`wrote ${file}`);
}
