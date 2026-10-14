export const CHROME_PREFIX: string;
export const DEFAULT_TOOLS: string[];
export const DEFAULT_HOSTS: string[];
export interface ApproverRulesConfig {
  tools: string[];
  hosts: string[];
  fileRoots: string[];
  js: boolean;
  killFile: string;
  killEnv: boolean;
  deviceId?: string;
  platform?: string;
}
export interface Decision {
  behavior: "allow" | "deny";
  reason: string;
  host?: string;
  note?: string;
}
export function configFromEnv(env?: Record<string, string | undefined>): ApproverRulesConfig;
export function isKilled(cfg: Pick<ApproverRulesConfig, "killFile" | "killEnv">): boolean;
export function hostAllowed(host: string, hosts: string[]): boolean;
export function urlDecision(raw: unknown, hosts: string[], opts?: { history?: boolean }): { ok: boolean; host: string; reason?: string };
export function pathDecision(p: unknown, roots: string[], platform?: string): { ok: boolean; reason?: string };
export function decide(toolName: string, input: unknown, cfg: ApproverRulesConfig): Decision;
