import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "test" ? [] : files(p);
    return /\.(tsx?|css|html)$/.test(f) ? [p] : [];
  });
}
const sources = files(ROOT).map((p) => ({ p, s: readFileSync(p, "utf8") }));

describe("source policy", () => {
  it("makes no prohibited marketing or automation claims", () => {
    const banned = [/guarantee(d)? (tatkal|ticket|booking|confirmed)/i, /100% automatic/i, /bot booking/i, /bypass captcha/i, /instant guaranteed/i, /auto[- ]?solve/i];
    const hits = sources.flatMap(({ p, s }) => banned.filter((b) => b.test(s)).map((b) => `${p}: ${b}`));
    expect(hits).toEqual([]);
  });

  it("never renders raw HTML", () => {
    expect(sources.filter(({ s }) => s.includes("dangerouslySetInnerHTML")).map(({ p }) => p)).toEqual([]);
  });

  it("has no password inputs (no IRCTC password collection)", () => {
    expect(sources.filter(({ s }) => /type=["']password["']/.test(s)).map(({ p }) => p)).toEqual([]);
  });

  it("doesn't keep tokens in web storage", () => {
    const hits = sources.filter(({ s }) => /(localStorage|sessionStorage)\.setItem\([^)]*(token|otp|session)/i.test(s));
    expect(hits.map(({ p }) => p)).toEqual([]);
  });
});
