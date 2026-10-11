import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // The manifest applies to the whole app (also for Viewers and with the module off), so the name
    // stays neutral; only the start page is the capture page.
    name: "CustomerManagement",
    short_name: "Kunden",
    description: "Kundenverwaltung, auch zum Erfassen von Zeit und Material vor Ort.",
    start_url: "/time",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
