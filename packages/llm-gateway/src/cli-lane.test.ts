import { describe, expect, it } from "vitest";
import { runInLane } from "./cli.ts";

/** Bot chat (khách đang chờ) có làn riêng: không xếp hàng sau các tác vụ nền dài đang chiếm hết làn thường. */
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => (open = r)); return { p, open }; };

describe("làn chạy Claude CLI", () => {
  it("làn thường đầy bởi 2 tác vụ dài → lượt ưu tiên (bot chat) vẫn chạy NGAY, lượt thường thứ 3 phải chờ", async () => {
    const g1 = gate(), g2 = gate();
    const started: string[] = [];
    const long1 = runInLane(async () => { started.push("long1"); await g1.p; });
    const long2 = runInLane(async () => { started.push("long2"); await g2.p; });
    const long3 = runInLane(async () => { started.push("long3"); });
    const chat = runInLane(async () => { started.push("chat"); return "ok"; }, true);
    await expect(chat).resolves.toBe("ok");
    expect(started).toEqual(["long1", "long2", "chat"]); // long3 vẫn chờ làn thường
    g1.open();
    await long1; await long3;
    expect(started).toContain("long3");
    g2.open();
    await long2;
  });

  it("làn ưu tiên có giới hạn riêng: vượt thì xếp hàng trong làn ưu tiên, không chen làn thường", async () => {
    const gates = [gate(), gate(), gate()];
    const started: number[] = [];
    const runs = gates.map((g, i) => runInLane(async () => { started.push(i); await g.p; }, true));
    const fourth = runInLane(async () => { started.push(3); }, true);
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[0].open();
    await runs[0]; await fourth;
    expect(started).toEqual([0, 1, 2, 3]);
    gates[1].open(); gates[2].open();
    await Promise.all(runs);
  });
});
