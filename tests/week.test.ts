import { describe, expect, it } from "vitest";
import { isoWeekId } from "@/lib/week";

describe("isoWeekId", () => {
  it("labels a Sunday with the week that started on the Monday before", () => {
    // Sunday 11 October 2026 belongs to the week starting Monday 5 October.
    expect(isoWeekId(new Date("2026-10-11T00:30:00Z"))).toBe("2026-W41");
  });

  it("starts a new week on Monday", () => {
    expect(isoWeekId(new Date("2026-10-12T00:00:00Z"))).toBe("2026-W42");
  });

  it("handles a year boundary (1 January 2027 is a Friday in 2026-W53)", () => {
    expect(isoWeekId(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });

  it("pads single-digit weeks", () => {
    expect(isoWeekId(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });
});
