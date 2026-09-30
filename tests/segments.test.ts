import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countRecipients, listRecipients } from "@/lib/campaigns/recipients";
import { addMembers, createSegment } from "@/lib/segments/service";
import { resetDb, testDb } from "./helpers/db";
import { makeSubscriber } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

describe("segments", () => {
  it("resolves all, grade, teacher and committee rules against eligible subscribers only", async () => {
    const k1 = await makeSubscriber(db, { grade: "K", teacher: "Rivera" });
    const k2 = await makeSubscriber(db, { grade: "K", teacher: "Chen" });
    const g3 = await makeSubscriber(db, { grade: "3", teacher: "Rivera" });
    await makeSubscriber(db, { grade: "K", status: "pending", confirmedAt: null });

    const all = await createSegment(db, { name: "All", rule: "all" });
    const k = await createSegment(db, { name: "K", rule: "grade=K" });
    const rivera = await createSegment(db, { name: "Rivera", rule: " teacher = Rivera " });
    const garden = await createSegment(db, { name: "Garden", rule: "committee=Garden" });
    expect(rivera.rule).toBe("teacher=Rivera");
    const added = await addMembers(db, garden.id, [g3.email.toUpperCase(), "stranger@example.com"]);
    expect(added).toEqual({ added: 1, unknown: ["stranger@example.com"] });

    expect(await countRecipients(db, all.id)).toBe(3);
    expect(await countRecipients(db, null)).toBe(3);
    expect((await listRecipients(db, k.id)).map((r) => r.id).sort()).toEqual([k1.id, k2.id].sort());
    expect((await listRecipients(db, rivera.id)).map((r) => r.id).sort()).toEqual([k1.id, g3.id].sort());
    expect((await listRecipients(db, garden.id)).map((r) => r.id)).toEqual([g3.id]);
  });

  it("rejects invalid rules", async () => {
    await expect(createSegment(db, { name: "Bad", rule: "school=x" })).rejects.toThrow();
  });
});
