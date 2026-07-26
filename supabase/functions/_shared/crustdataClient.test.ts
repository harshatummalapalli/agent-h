import { describe, it, expect } from "vitest";
import {
  classifyPlace,
  parseLocationForFilter,
  COUNTRY_ALIASES,
} from "./crustdataClient";

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

describe("classifyPlace", () => {
  it("routes 'India' to the country field with exact match", () => {
    const result = classifyPlace("India");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.type).toBe("=");
    expect(result.value).toBe("India");
  });

  it("routes 'india' (lowercase) correctly", () => {
    const result = classifyPlace("india");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.value).toBe("India");
  });

  it("routes 'US' alias to United States on country field", () => {
    const result = classifyPlace("US");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.type).toBe("=");
    expect(result.value).toBe("United States");
  });

  it("routes 'usa' alias to United States", () => {
    expect(classifyPlace("usa").value).toBe("United States");
  });

  it("routes 'UK' alias to United Kingdom", () => {
    const result = classifyPlace("UK");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.value).toBe("United Kingdom");
  });

  it("routes 'UAE' to United Arab Emirates", () => {
    expect(classifyPlace("UAE").value).toBe("United Arab Emirates");
  });

  it("routes 'Dubai' to United Arab Emirates", () => {
    expect(classifyPlace("Dubai").value).toBe("United Arab Emirates");
  });

  it("routes 'Bangalore' to the city field with contains match", () => {
    const result = classifyPlace("Bangalore");
    expect(result.field).toBe("basic_profile.location.city");
    expect(result.type).toBe("(.)");
    expect(result.value).toBe("Bangalore");
  });

  it("routes 'New York' to city field", () => {
    const result = classifyPlace("New York");
    expect(result.field).toBe("basic_profile.location.city");
    expect(result.type).toBe("(.)");
  });

  it("routes 'San Francisco' to city field", () => {
    expect(classifyPlace("San Francisco").field).toBe(
      "basic_profile.location.city",
    );
  });

  it("COUNTRY_ALIASES has India entry", () => {
    expect(COUNTRY_ALIASES["india"]).toBe("India");
  });
});
