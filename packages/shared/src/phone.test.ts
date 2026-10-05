import { describe, expect, it } from "vitest";
import { extractVnPhones, maskPhonesInText, normalizeVnPhone } from "./phone.ts";

/** SĐT Việt Nam trong tin nhắn khách: không nhầm giá tiền / mã đơn thành SĐT, không ghép ra số người lạ. */
describe("extractVnPhones", () => {
  const cases: [string, string[]][] = [
    ["+84 0912 345 678", ["0912345678"]],
    ["+84912345678", ["0912345678"]],
    ["84 912 345 678", ["0912345678"]],
    ["0912.345.678", ["0912345678"]],
    ["0912 345 678", ["0912345678"]],
    ["sđt: 0912-345-678", ["0912345678"]],
    ["zalo 0987654321 nhé", ["0987654321"]],
    ["giá 390.000.000đ", []],
    ["giá 390.000.000", []],
    ["giá 390000000 đồng", []],
    ["350k", []],
    ["1.250.000 vnđ", []],
    ["mã đơn 123456789012", []],
    ["số bàn 0283 822 1234", []],
    ["sđt 0912 345 678 hoặc 0987.654.321 nha", ["0912345678", "0987654321"]],
    ["0912 345 678 0987 654 321", ["0912345678", "0987654321"]],
    ["sđt 0912345678 không có zalo", ["0912345678"]],
    ["912345678", ["0912345678"]],
  ];
  it.each(cases)("%s", (text, want) => {
    expect(extractVnPhones(text)).toEqual(want);
  });

  it("chuẩn hoá +84 0…", () => {
    expect(normalizeVnPhone("+84 0912 345 678")).toBe("0912345678");
    expect(normalizeVnPhone("84912345678")).toBe("0912345678");
    expect(normalizeVnPhone("0283 822 1234")).toBeNull();
  });
});

describe("maskPhonesInText", () => {
  it("che SĐT, giữ nguyên giá tiền", () => {
    expect(maskPhonesInText("giá 390.000.000đ, ship 30.000 vnđ")).toBe("giá 390.000.000đ, ship 30.000 vnđ");
    expect(maskPhonesInText("tổng 1.250.000 nhé")).toBe("tổng 1.250.000 nhé");
    expect(maskPhonesInText("giá 390.000.000đ, zalo 0912 345 678 nhé")).toBe("giá 390.000.000đ, zalo 0912***678 nhé");
    expect(maskPhonesInText("+84 0912 345 678")).toBe("0912***678");
    expect(maskPhonesInText("gọi 0912345678 hoặc 0987654321")).toBe("gọi 0912***678 hoặc 0987***321");
    expect(maskPhonesInText("0912 345 678 0987 654 321")).toBe("0912***678 0987***321");
  });
});
