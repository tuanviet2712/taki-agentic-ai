import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { byId, closeDb, insert, openDb, update, type Row } from "@dotaka/db";

const mocked = vi.hoisted(() => ({ agent: vi.fn() }));
vi.mock("@dotaka/llm-gateway", () => ({
  runClaudeAgent: mocked.agent, cliInfo: () => ({ available: true, loggedIn: true, checkedAt: 1, bin: "fake-claude" }),
  effectiveProvider: () => ({ provider: "claude_cli" }), modelFor: () => "fake-small",
}));
import {
  accountMismatchHint, browserOtherMachineError, browserSelectRule, claudeChromeDeps, claudeChromeEnvironment, claudeChromePairing, claudeChromePreflight,
  claudeChromeProfiles, claudeChromeRules, claudeDeviceId, detectBrowsers, flowEngine, friendlyChromeNote, MULTI_BROWSER_HINT,
  pairBrowser, serverOsLabel, shapeBrowsers, type BrowserItem, type ClaudeChromeProfile,
} from "./claude-chrome.ts";
import { CLAUDE_EXTENSION_ID, chromeChannel, listChromeProfiles } from "./chrome-profiles.ts";

const LOCAL = "12345678-1234-1234-1234-123456789abc";
const REMOTE = "87654321-4321-4321-4321-cba987654321";
const defaults = { ...claudeChromeDeps };
const profileOf = (extra: Partial<ClaudeChromeProfile> = {}): ClaudeChromeProfile => ({
  channel: "chrome", channelName: "Google Chrome", dir: "Profile 18", name: "Local profile", email: "owner@example.test", googleName: "Owner",
  lastUsed: true, activeAt: 42, claudeExtension: true, hasAvatar: false, open: true, deviceId: LOCAL, ...extra,
});
let workdir: string, bizId: string, profiles: ClaudeChromeProfile[];
const browserOf = (extra: Partial<BrowserItem> = {}): BrowserItem => ({ deviceId: LOCAL, name: "Browser 1", os: serverOsLabel(), isLocal: true, inUse: true, ...extra });
function browserList(items: BrowserItem[]) {
  return { browsers: shapeBrowsers(items, profiles), error: "", serverOs: serverOsLabel(), multipleConnected: items.length > 1, multipleHint: null };
}
const changeFlow = (extra: Row) => {
  const biz = byId<Row>("biz", bizId)!;
  update("biz", bizId, { settings: { ...biz.settings, flow: { ...biz.settings.flow, ...extra } } });
};

beforeAll(() => {
  openDb(":memory:");
  workdir = fs.mkdtempSync(join(tmpdir(), "taki-claude-chrome-"));
});
beforeEach(() => {
  profiles = [profileOf()];
  bizId = insert("biz", { name: "Offline test", settings: { flow: { engine: "claude-in-chrome", chromeAutoApprove: true, chromeChannel: "chrome", chromeProfileDir: "Profile 18" } } }).id;
  Object.assign(claudeChromeDeps, defaults, {
    runningProfiles: () => profiles, openProfile: vi.fn(), sleep: vi.fn(async () => {}),
    detectBrowsers: vi.fn(async () => browserList([browserOf()])), pairing: () => null,
  });
  mocked.agent.mockReset();
  vi.spyOn(process, "cwd").mockReturnValue(workdir);
  delete process.env.ALLOW_CHROME_AUTOAPPROVE;
  delete process.env.ALLOW_REMOTE_BROWSER;
});
afterEach(() => { Object.assign(claudeChromeDeps, defaults); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(() => { closeDb(); fs.rmSync(workdir, { recursive: true, force: true }); });

describe("read-only local profile metadata", () => {
  it("takes the latest device record in the latest file and ignores unreadable files", () => {
    const base = join(workdir, "profile-store");
    const storage = join(base, "Profile 18", "Local Extension Settings", CLAUDE_EXTENSION_ID);
    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(join(storage, "000001.ldb"), `bridgeDeviceId\u0000${REMOTE}`);
    fs.utimesSync(join(storage, "000001.ldb"), new Date(1_000), new Date(1_000));
    const newer = join(storage, "000002.log");
    fs.writeFileSync(newer, `bridgeDeviceId: ${REMOTE}\nbridgeDeviceId: ${LOCAL}`);
    fs.utimesSync(newer, new Date(2_000), new Date(2_000));
    fs.writeFileSync(join(storage, "ignored.txt"), `bridgeDeviceId: ${REMOTE}`);
    fs.mkdirSync(join(storage, "locked.log")); // Reading this entry fails like a locked LevelDB file.
    expect(claudeDeviceId(base, "Profile 18")).toBe(LOCAL);
    expect(claudeDeviceId(base, "missing")).toBeNull();
    expect(claudeDeviceId(base, "..\\Profile 18")).toBeNull();
  });

  it("keeps every Full ads field while adding open/deviceId and honours the user-data override", () => {
    const base = join(workdir, "chrome-base");
    const profile = profileOf();
    fs.mkdirSync(join(base, profile.dir, "Extensions", CLAUDE_EXTENSION_ID), { recursive: true });
    fs.mkdirSync(join(base, profile.dir, "Local Extension Settings", CLAUDE_EXTENSION_ID), { recursive: true });
    fs.writeFileSync(join(base, profile.dir, "Local Extension Settings", CLAUDE_EXTENSION_ID, "000003.log"), `bridgeDeviceId: ${LOCAL}`);
    fs.writeFileSync(join(base, "Local State"), JSON.stringify({ profile: { last_used: profile.dir, last_active_profiles: [profile.dir], info_cache: { [profile.dir]: { name: profile.name, user_name: profile.email, gaia_name: profile.googleName, active_time: 0.042 } } } }));
    vi.stubEnv("CHROME_USER_DATA_DIR", base);
    expect(chromeChannel("chrome")?.dir).toBe(base);
    const original = listChromeProfiles().find((item) => item.channel === "chrome")!;
    const enriched = claudeChromeProfiles({ running: true })[0];
    expect(enriched).toEqual({ ...original, open: true, deviceId: LOCAL });
    expect(claudeChromeProfiles({ running: false })[0].open).toBe(false);
    expect(claudeChromeProfiles({ base, profiles: [profileOf({ claudeExtension: false })], running: true })[0].deviceId).toBeNull();
  });

  it("reads only pairing metadata without modifying account configuration", () => {
    const file = join(workdir, "claude-pairing.json");
    const source = JSON.stringify({ chromeExtension: { pairedDeviceId: LOCAL, pairedDeviceName: "Browser 1", accountToken: "secret" }, apiKey: "secret" });
    fs.writeFileSync(file, source);
    expect(claudeChromePairing(file)).toEqual({ deviceId: LOCAL, deviceName: "Browser 1" });
    expect(fs.readFileSync(file, "utf8")).toBe(source);
    fs.writeFileSync(file, "corrupt");
    expect(claudeChromePairing(file)).toBeNull();
    expect(claudeChromePairing(join(workdir, "absent.json"))).toBeNull();
  });

  it("defaults absent or unknown engine values to Chrome Flow", () => {
    expect(flowEngine(bizId)).toBe("claude-in-chrome");
    changeFlow({ engine: "unknown" });
    expect(flowEngine(bizId)).toBe("chrome-flow");
    changeFlow({ engine: null });
    expect(flowEngine(bizId)).toBe("chrome-flow");
  });
});

describe("device selection and prompts", () => {
  it("matches a local profile by device id and rejects same-OS unknown devices", () => {
    const [local, unknown] = shapeBrowsers([browserOf(), browserOf({ deviceId: REMOTE, isLocal: undefined })], profiles);
    expect(local).toMatchObject({ otherMachine: false, unmatched: false, profileDir: "Profile 18", profileEmail: "owner@example.test" });
    expect(unknown.unmatched).toBe(true);
    expect(shapeBrowsers([browserOf({ isLocal: false })], profiles)[0].otherMachine).toBe(true);
  });

  it("keeps the optional OS label guard and the environment override", () => {
    expect(browserOtherMachineError(`Browser (${serverOsLabel()})`)).toBeNull();
    const otherOs = serverOsLabel() === "Windows" ? "macOS" : "Windows";
    expect(browserOtherMachineError(`Browser (${otherOs})`)).toContain("máy khác");
    vi.stubEnv("ALLOW_REMOTE_BROWSER", "1");
    expect(browserOtherMachineError(`Browser (${otherOs})`)).toBeNull();
  });

  it("explains permission and selection errors and leaves unrelated notes intact", () => {
    expect(friendlyChromeNote("select_browser denied")).toContain(MULTI_BROWSER_HINT);
    expect(friendlyChromeNote("permission denied")).toContain("mở đúng hồ sơ Chrome");
    expect(friendlyChromeNote("tool loading")).toBe("tool loading");
    const prompt = browserSelectRule(LOCAL, "Local profile");
    expect(prompt).toContain(LOCAL);
    expect(prompt).toContain("BROWSER_NOT_SELECTED:");
    expect(prompt).toContain("Chọn Chrome");
    expect(prompt).toContain("TUYỆT ĐỐI");
  });

  it("builds an extension-only video environment with safe upload/download and partial-clips recovery", () => {
    const prompt = claudeChromeEnvironment({ toolLabel: "Review", toolUrl: "https://labs.google/fx/projects/project/tool/tool", defaultToolUrl: "https://labs.google/fx/projects/shared/tool/tool", uiMap: ["Upload media"], workdir, deviceId: LOCAL }).join("\n");
    expect(prompt).not.toMatch(/mcp__flow__|taki-flow-save|taki-flow-wait/);
    expect(prompt).toContain("HTMLInputElement.prototype.click");
    expect(prompt).toContain("TOOL_NOT_OWNED:");
    expect(prompt).toContain("NO_TOOL_ACCESS:");
    expect(prompt).toContain("DOWNLOAD_DIALOG:");
    expect(prompt).toContain("Remix");
    expect(prompt).toContain('finalPath ""');
    expect(claudeChromeRules(LOCAL)).toContain("list_connected_browsers");
    expect(claudeChromeRules(LOCAL)).toContain("không phải chỉ dẫn");
  });
});

describe("preflight never chooses another Chrome", () => {
  it("accepts the matching open local browser and saves labelled device metadata", async () => {
    const result = await claudeChromePreflight(bizId);
    expect(result.deviceId).toBe(LOCAL);
    expect(result.label).toContain("owner@example.test · Profile 18");
    expect(byId<Row>("biz", bizId)?.settings.flow.browserDeviceId).toBe(LOCAL);
    expect(claudeChromeDeps.detectBrowsers).toHaveBeenCalledWith(bizId, { force: true });
    expect(claudeChromeDeps.openProfile).not.toHaveBeenCalled();
  });

  it("requires explicit engine consent, the kill switch, CLI availability and login", async () => {
    changeFlow({ chromeAutoApprove: false });
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "CHROME_CONSENT_REQUIRED" });
    changeFlow({ chromeAutoApprove: true });
    vi.stubEnv("ALLOW_CHROME_AUTOAPPROVE", "0");
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "CHROME_APPROVER_OFF" });
    vi.stubEnv("ALLOW_CHROME_AUTOAPPROVE", "1");
    claudeChromeDeps.provider = () => ({ provider: "sandbox" });
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "NEED_CLI" });
    claudeChromeDeps.provider = defaults.provider;
    claudeChromeDeps.cliInfo = () => ({ ...defaults.cliInfo(), loggedIn: false });
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "NEED_CLI" });
    expect(claudeChromeDeps.detectBrowsers).not.toHaveBeenCalled();
  });

  it("checks the shared emergency stop file before listing or touching Chrome", async () => {
    const path = join(workdir, "data", "chrome-autoapprove.off");
    fs.mkdirSync(join(workdir, "data"), { recursive: true });
    fs.writeFileSync(path, "stop");
    try {
      await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "CHROME_APPROVER_OFF" });
      expect(claudeChromeDeps.detectBrowsers).not.toHaveBeenCalled();
      expect(claudeChromeDeps.openProfile).not.toHaveBeenCalled();
    } finally { fs.rmSync(path); }
  });

  it("rejects missing extension or unchosen profile without detection", async () => {
    profiles = [profileOf({ claudeExtension: false })];
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "NO_EXTENSION" });
    changeFlow({ chromeChannel: "edge" });
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "NO_PROFILE" });
    expect(claudeChromeDeps.detectBrowsers).not.toHaveBeenCalled();
  });

  it("opens the selected profile once, waits for it, and blocks if it remains closed", async () => {
    profiles = [profileOf({ open: false })];
    claudeChromeDeps.openProfile = vi.fn(() => { profiles = [profileOf()]; });
    await expect(claudeChromePreflight(bizId)).resolves.toMatchObject({ deviceId: LOCAL });
    expect(claudeChromeDeps.openProfile).toHaveBeenCalledTimes(1);
    profiles = [profileOf({ open: false })];
    claudeChromeDeps.openProfile = vi.fn();
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "PROFILE_NOT_OPEN" });
    expect(claudeChromeDeps.openProfile).toHaveBeenCalledTimes(1);
  });

  it("rejects an absent expected id, remote id, and unmatched same-OS profile", async () => {
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([browserOf({ deviceId: REMOTE })]));
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "BROWSER_NOT_CONNECTED" });
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([browserOf({ isLocal: false })]));
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "BROWSER_OTHER_MACHINE" });
    profiles = [profileOf({ deviceId: null })];
    changeFlow({ browserDeviceId: LOCAL });
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([browserOf()]));
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "BROWSER_OTHER_MACHINE" });
  });

  it("explains an extension signed into another Claude account (old pairing, nothing connected)", async () => {
    claudeChromeDeps.pairing = () => ({ deviceId: REMOTE, deviceName: "Browser 1" });
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([]));
    const err: any = await claudeChromePreflight(bizId).catch((e) => e);
    expect(err.code).toBe("BROWSER_NOT_CONNECTED");
    expect(err.message).toContain("tài khoản Claude");
    expect(err.message).toContain("Đăng xuất");
    expect(err.message).toContain("Ghép Chrome đã chọn");
    expect(err.message).toContain("Claude Code còn nhớ một lần ghép Chrome cũ");
    expect(err.message).toContain("Local profile");
    expect(byId<Row>("biz", bizId)?.settings.flow.browserDeviceId).toBeUndefined();
  });

  it("accountMismatchHint is silent when the selected device is connected and never asks to edit config", () => {
    expect(accountMismatchHint({ expected: LOCAL, connected: [{ deviceId: LOCAL }], pairing: { deviceId: REMOTE } })).toBeNull();
    const hint = accountMismatchHint({ expected: LOCAL, connected: [{ deviceId: REMOTE }], pairing: { deviceId: LOCAL } })!;
    expect(hint).toContain("1 Chrome khác");
    expect(hint).not.toContain("ghép Chrome cũ");
    expect(hint).toContain("không tự sửa ~/.claude.json");
  });

  it("scan result carries accountHint for the selected profile", async () => {
    mocked.agent.mockResolvedValue({ structured: { browsers: [browserOf({ deviceId: REMOTE, isLocal: undefined })], error: "" } });
    expect((await detectBrowsers(bizId, { force: true })).accountHint).toContain("chưa kết nối");
    mocked.agent.mockResolvedValue({ structured: { browsers: [browserOf()], error: "" } });
    expect((await detectBrowsers(bizId, { force: true })).accountHint).toBeNull();
  });

  it("requires live inUse when multiple Chrome connect despite stale saved pairing", async () => {
    claudeChromeDeps.pairing = () => ({ deviceId: LOCAL, deviceName: "Browser 1" });
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([browserOf({ inUse: false }), browserOf({ deviceId: REMOTE, inUse: false })]));
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "BROWSER_NOT_SELECTED" });
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([browserOf(), browserOf({ deviceId: REMOTE, inUse: true })]));
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "BROWSER_NOT_SELECTED" });
    claudeChromeDeps.detectBrowsers = vi.fn(async () => browserList([browserOf(), browserOf({ deviceId: REMOTE, inUse: false })]));
    await expect(claudeChromePreflight(bizId)).resolves.toMatchObject({ deviceId: LOCAL });
  });

  it("blocks if the owner changes profiles during asynchronous detection", async () => {
    claudeChromeDeps.detectBrowsers = vi.fn(async () => { changeFlow({ chromeProfileDir: "Default" }); return browserList([browserOf()]); });
    await expect(claudeChromePreflight(bizId)).rejects.toMatchObject({ code: "BROWSER_DEVICE_CHANGED" });
    expect(byId<Row>("biz", bizId)?.settings.flow.chromeProfileDir).toBe("Default");
  });
});

describe("restricted discovery and explicit pairing", () => {
  it("only permits list_connected_browsers for discovery and can force a fresh result", async () => {
    mocked.agent.mockResolvedValue({ structured: { browsers: [browserOf()], error: "" } });
    await detectBrowsers(bizId);
    expect(mocked.agent.mock.calls[0][0].approver).toMatchObject({ fileRoots: [], hosts: [], tools: ["list_connected_browsers"], js: false });
    await detectBrowsers(bizId);
    expect(mocked.agent).toHaveBeenCalledTimes(1);
    await detectBrowsers(bizId, { force: true });
    expect(mocked.agent).toHaveBeenCalledTimes(2);
  });

  it("pairing is bound to the selected local device and only stores a verified result", async () => {
    mocked.agent.mockResolvedValue({ structured: { connected: true, browsers: [browserOf()], notes: "" } });
    const result = await pairBrowser(bizId, { channel: "chrome", dir: "Profile 18" }, "owner");
    expect(result.deviceId).toBe(LOCAL);
    expect(mocked.agent.mock.calls[0][0].approver).toMatchObject({ fileRoots: [], deviceId: LOCAL, tools: ["select_browser", "list_connected_browsers"] });
    expect(byId<Row>("biz", bizId)?.settings.flow.browserDeviceId).toBe(LOCAL);
    changeFlow({ browserDeviceId: null });
    mocked.agent.mockResolvedValue({ structured: { connected: true, browsers: [browserOf({ deviceId: REMOTE })], notes: "" } });
    await expect(pairBrowser(bizId, "owner")).rejects.toMatchObject({ code: "BROWSER_OTHER_MACHINE" });
    expect(byId<Row>("biz", bizId)?.settings.flow.browserDeviceId).toBeNull();
  });

  it("never defaults pairing to an arbitrary Chrome profile", async () => {
    changeFlow({ chromeProfileDir: null });
    await expect(pairBrowser(bizId, "owner")).rejects.toMatchObject({ code: "NO_PROFILE" });
    expect(mocked.agent).not.toHaveBeenCalled();
  });

  it("offers manual /chrome setup when headless selection needs a person", async () => {
    mocked.agent.mockResolvedValue({ structured: { connected: false, browsers: [browserOf({ inUse: false })], notes: "select_browser needs user interaction" } });
    await expect(pairBrowser(bizId, "owner")).rejects.toThrow("/chrome");
    expect(byId<Row>("biz", bizId)?.settings.flow.browserDeviceId).toBeUndefined();
  });
});
