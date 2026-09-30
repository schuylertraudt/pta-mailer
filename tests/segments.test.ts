import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countRecipients, listRecipients } from "@/lib/campaigns/recipients";
import { addMembers, createSegment } from "@/lib/segments/service";
import { resetDb, testDb } from "./helpers/db";
import { makeSubscriber } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

describe("segments", () => {
  it("resolves all, school and committee rules against eligible subscribers only", async () => {
    const k1 = await makeSubscriber(db, { school: "Karigon" });
    const k2 = await makeSubscriber(db, { school: "Karigon" });
    const o1 = await makeSubscriber(db, { school: "Orenda" });
    await makeSubscriber(db, { school: "Karigon", status: "pending", confirmedAt: null });

    const all = await createSegment(db, { name: "All", rule: "all" });
    const karigon = await createSegment(db, { name: "Karigon", rule: " school = Karigon " });
    const garden = await createSegment(db, { name: "Garden", rule: "committee=Garden" });
    expect(karigon.rule).toBe("school=Karigon");
    const added = await addMembers(db, garden.id, [o1.email.toUpperCase(), "stranger@example.com"]);
    expect(added).toEqual({ added: 1, unknown: ["stranger@example.com"] });

    expect(await countRecipients(db, all.id)).toBe(3);
    expect(await countRecipients(db, null)).toBe(3);
    expect((await listRecipients(db, karigon.id)).map((r) => r.id).sort()).toEqual([k1.id, k2.id].sort());
    expect((await listRecipients(db, garden.id)).map((r) => r.id)).toEqual([o1.id]);
  });

  it("rejects invalid and retired rules", async () => {
    for (const rule of ["school=", "grade=K", "teacher=Rivera"]) {
      await expect(createSegment(db, { name: rule, rule })).rejects.toThrow();
    }
  });
});
