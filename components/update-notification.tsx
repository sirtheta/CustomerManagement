import { checkForUpdate } from "@/lib/check-update";

export async function UpdateNotification() {
  const result = await checkForUpdate();

  if (!result?.hasUpdate) return null;

  return (
    <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-4 text-sm">
        <span className="text-blue-800 dark:text-blue-200">
          Neue Version verfügbar:{" "}
          <strong>v{result.latestVersion}</strong>{" "}
          <span className="text-blue-600 dark:text-blue-400">
            (aktuell: v{result.currentVersion})
          </span>
        </span>
        <a
          href="https://github.com/sirtheta/customermanagement/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline shrink-0 font-medium"
        >
          Changelog →
        </a>
      </div>
    </div>
  );
}
