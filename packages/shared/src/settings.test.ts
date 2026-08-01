import { describe, it, expect } from "vitest";
import { SETTING_KEYS, parseSetting, serializeSetting, defaultSettingRaw, SETTINGS } from "./settings.js";

describe("registro de settings", () => {
  it("son las 18 claves originales más las 2 del ticket configurable", () => {
    expect(SETTING_KEYS).toHaveLength(20);
  });

  it("ida y vuelta por texto no pierde el valor", () => {
    for (const k of SETTING_KEYS) {
      const raw = defaultSettingRaw(k);
      expect(parseSetting(k, raw)).toEqual((SETTINGS as any)[k].default);
    }
  });

  it("los booleanos se guardan como texto", () => {
    expect(serializeSetting("stock.allowNegative", false)).toBe("false");
    expect(parseSetting("stock.allowNegative", "true")).toBe(true);
    expect(parseSetting("stock.allowNegative", "false")).toBe(false);
  });

  it("rechaza un valor corrupto en vez de devolver NaN", () => {
    expect(() => parseSetting("tax.rate", "diecinueve")).toThrow();
    expect(() => parseSetting("tax.rate", "")).toThrow();
  });

  it("no existe location.default: duplicaba Location.isDefault", () => {
    expect(SETTING_KEYS).not.toContain("location.default" as never);
  });
});
