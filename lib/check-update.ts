import pkg from "../package.json";

type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
};

export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(
      "https://api.github.com/repos/sirtheta/customermanagement/releases/latest",
      {
        next: { revalidate: 3600 },
        headers,
      }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const tagName: string = data.tag_name ?? "";

    const match = tagName.match(/^v(.+)$/);
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
