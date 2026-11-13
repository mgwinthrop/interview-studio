import { describe, expect, it } from "vitest";
import { float32ToPCM16 } from "../../app/lib/pcmEncoder";

const toInt16 = (buf: ArrayBuffer) => Array.from(new Int16Array(buf));

describe("float32ToPCM16", () => {
  it("writes two bytes per sample", () => {
    expect(float32ToPCM16(new Float32Array(160)).byteLength).toBe(320);
    expect(float32ToPCM16(new Float32Array(0)).byteLength).toBe(0);
  });

  it("maps silence, full scale and negative full scale", () => {
    expect(toInt16(float32ToPCM16(Float32Array.from([0, 1, -1])))).toEqual([0, 32767, -32767]);
  });

  it("scales in-range samples proportionally", () => {
    const [half, negHalf] = toInt16(float32ToPCM16(Float32Array.from([0.5, -0.5])));
    expect(half).toBeCloseTo(16383, -1);
    expect(negHalf).toBeCloseTo(-16383, -1);
  });

  it("clamps samples outside [-1, 1] instead of wrapping", () => {
    expect(toInt16(float32ToPCM16(Float32Array.from([2, -2, 100])))).toEqual([32767, -32767, 32767]);
  });

  it("is little-endian (the wire format the backend expects)", () => {
    // 0x7FFF = 32767 -> bytes FF 7F in little-endian order
    const bytes = new Uint8Array(float32ToPCM16(Float32Array.from([1])));
    expect(Array.from(bytes)).toEqual([0xff, 0x7f]);
  });
});
