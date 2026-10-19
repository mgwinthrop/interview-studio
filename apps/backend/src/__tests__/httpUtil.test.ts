import { afterEach, describe, expect, it, vi } from "vitest";
import type express from "express";
import { ownerOf, route } from "../httpUtil";
import { errName } from "../errors";

function fakeRes(headersSent = false) {
  const res = {
    headersSent,
    locals: { ownerId: "owner-1" },
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

const asReq = (v: object) => v as unknown as express.Request<Record<string, string>>;
const asRes = (v: object) => v as unknown as express.Response;

afterEach(() => vi.restoreAllMocks());

describe("errName", () => {
  it("returns the error class name, or the typeof for non-errors", () => {
    expect(errName(new TypeError("x"))).toBe("TypeError");
    expect(errName("boom")).toBe("string");
    expect(errName(undefined)).toBe("undefined");
  });
});

describe("ownerOf", () => {
  it("reads the owner id from res.locals", () => {
    expect(ownerOf(asRes(fakeRes()))).toBe("owner-1");
  });
});

describe("route", () => {
  it("answers 500 and logs the error class when the handler rejects", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    await route("thing", async () => {
      throw new RangeError("secret detail");
    })(asReq({}), asRes(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal error" });
    expect(log).toHaveBeenCalledWith("[http] thing error: RangeError");
  });

  it("does nothing extra when the handler resolves", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    await route("thing", async () => {})(asReq({}), asRes(res));
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("does not write a second response when headers are already sent", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes(true);
    await route("thing", async () => {
      throw new Error("late");
    })(asReq({}), asRes(res));
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[http] thing error: Error");
  });
});
