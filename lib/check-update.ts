import { unstable_cache } from "next/cache";
import pkg from "../package.json";

type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
};

// Wrapped in unstable_cache (rather than relying on the fetch()'s own
// `next.revalidate`) because checkForUpdate() is always invoked after a
// Request-time API (auth() in app/(app)/layout.tsx reads cookies before
// <UpdateNotification> renders). Next.js' default fetchCache heuristic never
// caches a fetch discovered after a Request-time API, so `next: { revalidate }`
// on the fetch itself is silently ignored there and every admin page view
// hits the GitHub API directly — quickly exhausting the 60 req/hour
// unauthenticated rate limit and making the check fail intermittently.
// unstable_cache caches the resolved tag name in the Data Cache independent
// of that heuristic, so this only actually calls GitHub once per hour.
const getLatestReleaseTag = unstable_cache(
  async (): Promise<string | null> => {
    const res = await fetch(
      "https://api.github.com/repos/sirtheta/customermanagement/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return null;

    const data = await res.json();
    return typeof data.tag_name === "string" ? data.tag_name : null;
  },
  ["github-latest-release"],
  { revalidate: 3600 }
);

export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  try {
    const tagName = await getLatestReleaseTag();
    if (!tagName) return null;

    const match = tagName.match(/v(\d+\.\d+\.\d+.*)$/);
    if (!match) return null;

    const latestVersion = match[1];
    const currentVersion = pkg.version;

    return {
      currentVersion,
      latestVersion,
      hasUpdate: isNewerVersion(currentVersion, latestVersion),
    };
  } catch {
    return null;
  }
}

function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
