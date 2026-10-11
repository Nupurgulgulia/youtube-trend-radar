import { describe, expect, it } from "vitest";
import { briefWeekId, isoWeekId } from "@/lib/week";

describe("briefWeekId (most recent Sunday, India time)", () => {
  it("gives the Sunday cron runs that Sunday's week", () => {
    expect(briefWeekId(new Date("2026-10-11T00:30:00Z"))).toBe("2026-W41"); // 06:00 IST Sunday
    expect(briefWeekId(new Date("2026-10-11T04:29:00Z"))).toBe("2026-W41"); // catch-up, late in its hour
    expect(briefWeekId(new Date("2026-10-18T00:30:00Z"))).toBe("2026-W42");
  });

  it("treats a weekday run as late for the Sunday just gone, not next Sunday", () => {
    expect(briefWeekId(new Date("2026-10-12T10:00:00Z"))).toBe("2026-W41"); // Monday
    expect(isoWeekId(new Date("2026-10-12T10:00:00Z"))).toBe("2026-W42"); // what it must not use
    expect(briefWeekId(new Date("2026-10-17T12:00:00Z"))).toBe("2026-W41"); // Saturday
  });

  it("uses India time at the day boundary", () => {
    // Saturday 20:00 UTC is already Sunday 01:30 in India.
    expect(briefWeekId(new Date("2026-10-17T20:00:00Z"))).toBe("2026-W42");
    // Sunday 18:00 UTC is Sunday 23:30 in India, still that Sunday.
    expect(briefWeekId(new Date("2026-10-18T18:00:00Z"))).toBe("2026-W42");
  });
});

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
