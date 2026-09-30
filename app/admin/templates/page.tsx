import { getDb } from "@/db";
import { isStarter, listTemplates } from "@/lib/templates/service";
import TemplateList from "@/components/admin/TemplateList";

export default async function TemplatesPage() {
  const templates = await listTemplates(getDb());
  return (
    <div className="stack">
      <h1>Templates</h1>
      <p className="muted">Save any campaign as a template from the composer. Starter templates can&apos;t be deleted.</p>
      <TemplateList templates={templates.map((t) => ({ id: t.id, name: t.name, starter: isStarter(t.id), updatedAt: t.updatedAt.toISOString() }))} />
    </div>
  );
}
