import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Plain .mjs entry points (Ngân Nguyệt's MCP server, taki-flow-save, install scripts) are not type-checked;
// a stray quote once broke taki-mcp.mjs silently. `node --check` catches that.
const files = [
  ...readdirSync(resolve(__dirname, "../bin")).filter((f) => f.endsWith(".mjs")).map((f) => resolve(__dirname, "../bin", f)),
  ...readdirSync(resolve(__dirname, "../../../scripts")).filter((f) => f.endsWith(".mjs")).map((f) => join(resolve(__dirname, "../../../scripts"), f)),
];

describe("script syntax", () => {
  it.each(files)("%s parses", (f) => {
    expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
  });
});
