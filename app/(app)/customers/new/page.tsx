import CustomerForm from "../CustomerForm";
import { isEditorSession, requireSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

export default async function NewCustomerPage() {
  if (!isEditorSession(await requireSession())) return <EditorOnlyNotice backHref="/customers" backLabel="Zu den Kunden" />;
  return (
    <div className="max-w-2xl">
      <CustomerForm />
    </div>
  );
}
