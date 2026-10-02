import CustomerForm from "../CustomerForm";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

export default async function NewCustomerPage() {
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/customers" backLabel="Zu den Kunden" />;
  return (
    <div className="max-w-2xl">
      <CustomerForm />
    </div>
  );
}
