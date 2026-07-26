import { describe, it, expect } from "vitest";
import { parseLocationForFilter } from "./crustdataClient";

describe("parseLocationForFilter", () => {
  it("extracts India from 'Remote, India'", () => {
    expect(parseLocationForFilter("Remote, India")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'Remote - India'", () => {
    expect(parseLocationForFilter("Remote - India")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'India (Remote)'", () => {
    expect(parseLocationForFilter("India (Remote)")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'Remote people based in India'", () => {
    expect(parseLocationForFilter("Remote people based in India")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'based in India, remote OK'", () => {
    expect(parseLocationForFilter("based in India, remote OK")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("returns remoteOnly=true for 'Remote'", () => {
    expect(parseLocationForFilter("Remote")).toEqual({
      place: null,
      remoteOnly: true,
    });
  });

  it("returns remoteOnly=true for 'Remote only'", () => {
    expect(parseLocationForFilter("Remote only")).toEqual({
      place: null,
      remoteOnly: true,
    });
  });

  it("returns remoteOnly=true for 'remote ok'", () => {
    expect(parseLocationForFilter("remote ok")).toEqual({
      place: null,
      remoteOnly: true,
    });
  });

  it("passes through a plain city with no remote mention", () => {
    const result = parseLocationForFilter("Bangalore");
    expect(result.place).toBe("Bangalore");
    expect(result.remoteOnly).toBe(false);
  });

  it("returns null place for empty string", () => {
    expect(parseLocationForFilter("")).toEqual({
      place: null,
      remoteOnly: false,
    });
  });
});
