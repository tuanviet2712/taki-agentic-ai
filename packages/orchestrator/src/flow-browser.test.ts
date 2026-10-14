import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chrome Flow trên Windows: cookie của Chrome thường gắn với thư mục dữ liệu gốc (app-bound encryption) nên KHÔNG chép sang được.
 * Lỗi cũ: mỗi lần chạy thấy "chưa đăng nhập" là xoá Chrome Flow rồi chép lại → mất cả đăng nhập tay của Sếp, lần nào cũng bắt đăng nhập.
 */
const root = mkdtempSync(join(tmpdir(), "taki-flowbrowser-"));
const chromeDir = join(root, "chrome");           // "User Data" của Chrome thường
const flowDir = join(root, "flow-chrome");        // Chrome Flow
process.env.FLOW_CHROME_DIR = flowDir;
process.env.FLOW_CDP_PORT = "59333"; // KHÔNG dùng cổng thật 9333: closeFlowBrowser() sẽ đóng Chrome Flow đang chạy của Sếp
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const setPlatform = (p: string) => Object.defineProperty(process, "platform", { value: p });
vi.mock("./chrome-profiles.ts", () => ({
  chromeChannel: () => ({ key: "chrome", dir: chromeDir, exe: "chrome.exe" }),
  listChromeProfiles: () => [{ channel: "chrome", dir: "Profile 18", name: "NGUYEN THI THANH", email: "hien@example.com" }],
}));
const { copyCarriesLogin, syncFlowProfile, flowSource, FLOW_CDP_PORT } = await import("./flow-browser.ts");

const localState = (appBound: boolean) => JSON.stringify({ os_crypt: appBound ? { app_bound_encrypted_key: "x" } : { encrypted_key: "y" }, profile: { info_cache: { "Profile 18": { name: "Hiền" } } } });
function everydayChrome(appBound: boolean) {
  rmSync(chromeDir, { recursive: true, force: true });
  mkdirSync(join(chromeDir, "Profile 18"), { recursive: true });
  writeFileSync(join(chromeDir, "Local State"), localState(appBound));
  writeFileSync(join(chromeDir, "Profile 18", "Cookies"), "SECRET-COOKIES");
}
beforeEach(() => { rmSync(flowDir, { recursive: true, force: true }); });
afterAll(() => { Object.defineProperty(process, "platform", platform); rmSync(root, { recursive: true, force: true }); });

describe("an toàn cho Chrome Flow thật", () => {
  it("test dùng cổng giả, không phải cổng thật 9333", () => { expect(FLOW_CDP_PORT).toBe(59333); });
});

describe("copyCarriesLogin", () => {
  it("Windows + app-bound cookies → the copy cannot carry the login; other cases can", () => {
    everydayChrome(true);
    setPlatform("win32"); expect(copyCarriesLogin(join(chromeDir, "Local State"))).toBe(false);
    setPlatform("darwin"); expect(copyCarriesLogin(join(chromeDir, "Local State"))).toBe(true);
    everydayChrome(false);
    setPlatform("win32"); expect(copyCarriesLogin(join(chromeDir, "Local State"))).toBe(true);
    expect(copyCarriesLogin(join(chromeDir, "khong-co"))).toBe(true);
  });
});

describe("syncFlowProfile keeps a Chrome Flow the CEO already signed in to", () => {
  it("Windows + app-bound: does NOT wipe data/flow-chrome, only remembers the source profile", async () => {
    setPlatform("win32"); everydayChrome(true);
    mkdirSync(join(flowDir, "Default"), { recursive: true });
    writeFileSync(join(flowDir, "Default", "Cookies"), "MANUAL-LOGIN");
    const src = await syncFlowProfile("chrome", "Profile 18");
    expect(readFileSync(join(flowDir, "Default", "Cookies"), "utf8")).toBe("MANUAL-LOGIN");
    expect(src).toMatchObject({ dir: "Profile 18", email: "hien@example.com" });
    expect(flowSource()).toMatchObject({ dir: "Profile 18" });
  });
  it("when the login can be copied, it still re-copies from the everyday profile as before", async () => {
    setPlatform("darwin"); everydayChrome(false);
    mkdirSync(join(flowDir, "Default"), { recursive: true });
    writeFileSync(join(flowDir, "Default", "Cookies"), "OLD");
    await syncFlowProfile("chrome", "Profile 18");
    expect(readFileSync(join(flowDir, "Default", "Cookies"), "utf8")).toBe("SECRET-COOKIES");
    expect(existsSync(join(flowDir, "Local State"))).toBe(true);
  });
});
