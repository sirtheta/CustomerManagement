export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
    const { default: prisma } = await import("@/lib/prisma");
    try {
      const { migrateSecretsAtRest } = await import("@/lib/crypto");
      await migrateSecretsAtRest(prisma);
    } catch (err) {
      console.error("[instrumentation] Secret-at-rest migration failed:", err);
    }
    const { startNotificationScheduler } = await import("@/lib/notifications");
    startNotificationScheduler();

    // Checkpoint WAL on shutdown so SQLite WAL changes flush to main .db file.
    // NEXT_MANUAL_SIG_HANDLE=true (set in the Dockerfile) disables Next's own
    // SIGTERM/SIGINT handler, which used to race this one and could call
    // process.exit() before $disconnect() finished — losing the last writes
    // to the WAL. That also means we're now the only thing exiting the
    // process on these signals, hence the fallback timeout below.
    const shutdown = () => {
      const forceExit = setTimeout(() => process.exit(0), 5000);
      prisma.$disconnect()
        .then(() => console.log("[instrumentation] DB connection closed, WAL checkpointed."))
        .catch((err) => console.error("[instrumentation] Error during DB disconnect:", err))
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(0);
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
