import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { campaigns, officers, segments } from "@/db/schema";
import { EMPTY_DOC } from "@/lib/editor/model";
import { sanitizeDoc } from "@/lib/editor/sanitize";
import { env } from "@/lib/env";
import { getTemplate } from "@/lib/templates/service";

export class CampaignError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 422,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const EDITABLE = ["draft", "pending_approval", "approved"] as const;

export const campaignPatch = z.object({
  subject: z.string().max(200).optional(),
  preheader: z.string().max(200).optional(),
  bodyJson: z.unknown().optional(),
  segmentId: z.uuid().nullable().optional(),
  showInArchive: z.boolean().optional(),
});

export async function getCampaign(db: DbOrTx, id: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) throw new CampaignError(404, "Campaign not found");
  return c;
}

export async function listCampaigns(db: DbOrTx) {
  return db
    .select({
      id: campaigns.id,
      subject: campaigns.subject,
      status: campaigns.status,
      updatedAt: campaigns.updatedAt,
      sentAt: campaigns.sentAt,
      createdBy: officers.email,
    })
    .from(campaigns)
    .leftJoin(officers, eq(officers.id, campaigns.createdBy))
    .orderBy(desc(campaigns.updatedAt));
}

export async function createCampaign(db: Db, officerId: string, opts: { templateId?: string | null } = {}) {
  let body: unknown = EMPTY_DOC;
  if (opts.templateId) {
    const t = await getTemplate(db, opts.templateId);
    if (!t) throw new CampaignError(404, "Template not found");
    body = t.bodyJson;
  }
  const [c] = await db
    .insert(campaigns)
    .values({
      bodyJson: sanitizeDoc(body, env().STORAGE_PUBLIC_BASE_URL),
      templateId: opts.templateId ?? null,
      createdBy: officerId,
    })
    .returning();
  return c;
}

/**
 * Any edit to a submitted or approved campaign sends it back to draft, so an
 * approval always covers exactly the content that goes out.
 */
export async function updateCampaign(db: Db, id: string, raw: z.input<typeof campaignPatch>) {
  const patch = campaignPatch.parse(raw);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!c) throw new CampaignError(404, "Campaign not found");
    if (!EDITABLE.includes(c.status as never)) throw new CampaignError(409, "This campaign has already been sent and can't be edited.");
    if (patch.segmentId) {
      const [seg] = await tx.select().from(segments).where(eq(segments.id, patch.segmentId));
      if (!seg) throw new CampaignError(400, "Unknown audience segment");
    }
    const [row] = await tx
      .update(campaigns)
      .set({
        ...(patch.subject !== undefined && { subject: patch.subject }),
        ...(patch.preheader !== undefined && { preheader: patch.preheader }),
        ...(patch.bodyJson !== undefined && { bodyJson: sanitizeDoc(patch.bodyJson, env().STORAGE_PUBLIC_BASE_URL) }),
        ...(patch.segmentId !== undefined && { segmentId: patch.segmentId }),
        ...(patch.showInArchive !== undefined && { showInArchive: patch.showInArchive }),
        status: "draft",
        approvedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id))
      .returning();
    return row;
  });
}

async function transition(db: Db, id: string, from: readonly string[], set: Partial<typeof campaigns.$inferInsert>) {
  const [row] = await db
    .update(campaigns)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, from as never)))
    .returning();
  if (!row) {
    const c = await getCampaign(db, id);
    throw new CampaignError(409, `Campaign is ${c.status.replace("_", " ")}; that action isn't available.`);
  }
  return row;
}

export const submitForApproval = (db: Db, id: string) => transition(db, id, ["draft"], { status: "pending_approval" });

export const approveCampaign = (db: Db, id: string, officerId: string) =>
  transition(db, id, ["pending_approval"], { status: "approved", approvedBy: officerId });

export const returnToDraft = (db: Db, id: string) =>
  transition(db, id, ["pending_approval", "approved"], { status: "draft", approvedBy: null });

export async function deleteDraft(db: Db, id: string) {
  const [row] = await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, ["draft", "pending_approval", "approved"])))
    .returning({ id: campaigns.id });
  if (!row) throw new CampaignError(409, "Only unsent campaigns can be deleted.");
}
