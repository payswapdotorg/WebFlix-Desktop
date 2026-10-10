import { describe, it, expect } from "vitest";
// Entry-point smoke: every public export of the D2 packages must load.
// (Catches corrupted/dead files the internal tests never import — the
// store.ts:12 corruption slipped through exactly this gap.)
import * as contracts from "../index";
import * as domain from "../../../webflix-domain/src/index";
import * as application from "../../../webflix-application/src/index";
import * as localLibrary from "../../../local-library/src/index";

describe("public entrypoints load", () => {
  it("webflix-contracts entrypoint exports the locked surface", () => {
    expect(Object.keys(contracts).length).toBeGreaterThan(10);
  });
  it("webflix-domain entrypoint exports domain logic", () => {
    expect(Object.keys(domain).length).toBeGreaterThan(5);
  });
  it("webflix-application entrypoint exports use-cases and ports", () => {
    expect(Object.keys(application).length).toBeGreaterThan(5);
  });
  it("local-library entrypoint exports the store surface", () => {
    expect(Object.keys(localLibrary).length).toBeGreaterThan(5);
    expect(typeof localLibrary.ALL_MIGRATIONS[Symbol.iterator]).toBe("function");
  });
});
