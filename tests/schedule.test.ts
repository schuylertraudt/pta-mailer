import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { campaigns, officers, sends } from "@/db/schema";
import { cancelSchedule, runDueSchedules, scheduleCampaign } from "@/lib/campaigns/schedule";
import { updateCampaign } from "@/lib/campaigns/service";
import { POST as scheduleRoute, DELETE as unscheduleRoute } from "../app/api/campaigns/[id]/schedule/route";
import { resetDb, testDb } from "./helpers/db";
import { mailbox, makeOfficer, makeSubscriber, sessionFor } from "./helpers/factories";
import { makeCampaign, realBrand } from "./helpers/campaign";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  mailbox().clear();
  await realBrand(db);
});

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
const reload = async (id: string) => (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];
/** Moves a scheduled time into the past, as if the clock had reached it. */
const makeDue = (id: string) => db.update(campaigns).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(campaigns.id, id));

describe("scheduled sending", () => {
  it("schedules, locks the message, and queues it when the time comes", async () => {
    await makeSubscriber(db);
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, s.id);
    const at = inMinutes(60);
    const { recipients } = await scheduleCampaign(db, c.id, s.id, at);
    expect(recipients).toBe(1);
    expect(await reload(c.id)).toMatchObject({ status: "scheduled", scheduledAt: at, scheduledBy: s.id, approvedBy: s.id });
    await expect(updateCampaign(db, c.id, { subject: "change" })).rejects.toThrow("Cancel the schedule to edit it");

    // Not yet due.
    expect(await runDueSchedules(db)).toBe(0);
    expect(await db.select().from(sends)).toHaveLength(0);

    // A family signs up before the send time and is included.
    await makeSubscriber(db);
    await makeDue(c.id);
    expect(await runDueSchedules(db)).toBe(1);
    expect(await reload(c.id)).toMatchObject({ status: "sending", sentBy: s.id });
    expect(await db.select().from(sends)).toHaveLength(2);
    expect(await runDueSchedules(db)).toBe(0);
  });

  it("checks everything up front and refuses times in the past or too far ahead", async () => {
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, s.id);
    await expect(scheduleCampaign(db, c.id, s.id, inMinutes(60))).rejects.toThrow("No eligible recipients");
    await makeSubscriber(db);
    await expect(scheduleCampaign(db, c.id, s.id, inMinutes(-5))).rejects.toThrow("at least a minute from now");
    await expect(scheduleCampaign(db, c.id, s.id, new Date("invalid"))).rejects.toThrow("Pick a date and time");
    await expect(scheduleCampaign(db, c.id, s.id, inMinutes(60 * 24 * 400))).rejects.toThrow("within the next year");
    const none = await makeCampaign(db, s.id, { segmentIds: [] });
    await expect(scheduleCampaign(db, none.id, s.id, inMinutes(60))).rejects.toThrow("Choose who");
    expect((await reload(c.id)).status).toBe("draft");
  });

  it("cancelling returns the message to approved and editable", async () => {
    await makeSubscriber(db);
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, s.id);
    await scheduleCampaign(db, c.id, s.id, inMinutes(30));
    await cancelSchedule(db, c.id);
    expect(await reload(c.id)).toMatchObject({ status: "approved", scheduledAt: null });
    await expect(cancelSchedule(db, c.id)).rejects.toThrow("isn't scheduled");
    await makeDue(c.id);
    expect(await runDueSchedules(db)).toBe(0);
    await updateCampaign(db, c.id, { subject: "Edited" });
    expect((await reload(c.id)).status).toBe("draft");
  });

  it("puts a message that can't send back in draft, says why, and emails the scheduler", async () => {
    const sub = await makeSubscriber(db);
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, s.id);
    await scheduleCampaign(db, c.id, s.id, inMinutes(30));
    // The only family unsubscribes before the send time.
    await db.delete(sends);
    const { subscribers } = await import("@/db/schema");
    await db.update(subscribers).set({ status: "unsubscribed" }).where(eq(subscribers.id, sub.id));
    await makeDue(c.id);
    expect(await runDueSchedules(db)).toBe(0);
    const row = await reload(c.id);
    expect(row).toMatchObject({ status: "draft", scheduledAt: null });
    expect(row.scheduleError).toMatch(/didn't go out: No eligible recipients/);
    const notice = mailbox().sent.find((m) => m.to === s.email)!;
    expect(notice.subject).toBe("PTA mailer: a scheduled message didn't send");
  });

  it("doesn't send for someone who lost send rights", async () => {
    await makeSubscriber(db);
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, s.id);
    await scheduleCampaign(db, c.id, s.id, inMinutes(30));
    await db.update(officers).set({ role: "drafter" }).where(eq(officers.id, s.id));
    await makeDue(c.id);
    expect(await runDueSchedules(db)).toBe(0);
    expect((await reload(c.id)).scheduleError).toMatch(/can no longer send/);
    expect(await db.select().from(sends)).toHaveLength(0);
  });

  it("only senders and admins can schedule or cancel", async () => {
    await makeSubscriber(db);
    const d = await makeOfficer(db, "drafter");
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, d.id);
    const call = async (route: typeof scheduleRoute, officerId: string, method: string, body?: object) =>
      route(
        new Request("https://pta.example.org/api/x", {
          method,
          headers: { ...(await sessionFor(db, officerId)).headers, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        { params: Promise.resolve({ id: c.id }) } as never,
      );
    const at = inMinutes(90).toISOString();
    expect((await call(scheduleRoute, d.id, "POST", { at })).status).toBe(403);
    const ok = await call(scheduleRoute, s.id, "POST", { at });
    expect(ok.status).toBe(200);
    expect((await ok.json()).recipients).toBe(1);
    expect((await call(unscheduleRoute, d.id, "DELETE")).status).toBe(403);
    expect((await call(unscheduleRoute, s.id, "DELETE")).status).toBe(200);
  });
});
