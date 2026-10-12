import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { TimeTabBar } from "./TimeTabBar";

export default async function TimeLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const editor = isEditorSession(session);
  return (
    <>
      {/* Room for the fixed tab bar on phones; below lg the content stays as narrow as on a phone. */}
      <div className={editor ? "mx-auto w-full max-w-xl pb-20 lg:max-w-none lg:pb-0" : undefined}>{children}</div>
      {editor && <TimeTabBar />}
    </>
  );
}
