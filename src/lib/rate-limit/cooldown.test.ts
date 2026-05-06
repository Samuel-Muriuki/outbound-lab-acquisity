/**
 * Unit tests for the per-IP per-domain cooldown debounce.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testOnly__,
  isOnCooldown,
  markTriggered,
} from "./cooldown";

beforeEach(() => {
  __testOnly__.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cooldown", () => {
  it("returns false for a key that has never been seen", () => {
    expect(isOnCooldown("1.2.3.4", "acquisity.ai")).toBe(false);
  });

  it("returns true immediately after markTriggered", () => {
    markTriggered("1.2.3.4", "acquisity.ai");
    expect(isOnCooldown("1.2.3.4", "acquisity.ai")).toBe(true);
  });

  it("returns false after the cooldown window expires", () => {
    markTriggered("1.2.3.4", "acquisity.ai");
    expect(isOnCooldown("1.2.3.4", "acquisity.ai")).toBe(true);
    vi.advanceTimersByTime(__testOnly__.cooldownMs + 1);
    expect(isOnCooldown("1.2.3.4", "acquisity.ai")).toBe(false);
  });

  it("scopes per-IP — one IP's cooldown does not block another", () => {
    markTriggered("1.1.1.1", "acquisity.ai");
    expect(isOnCooldown("1.1.1.1", "acquisity.ai")).toBe(true);
    expect(isOnCooldown("2.2.2.2", "acquisity.ai")).toBe(false);
  });

  it("scopes per-domain — same IP, different domain, no cooldown", () => {
    markTriggered("1.1.1.1", "acquisity.ai");
    expect(isOnCooldown("1.1.1.1", "stripe.com")).toBe(false);
  });

  it("treats keys case-insensitively", () => {
    markTriggered("1.1.1.1", "Acquisity.AI");
    expect(isOnCooldown("1.1.1.1", "acquisity.ai")).toBe(true);
    expect(isOnCooldown("1.1.1.1", "ACQUISITY.AI")).toBe(true);
  });

  it("isOnCooldown is a pure read — does not extend the window", () => {
    markTriggered("1.1.1.1", "acquisity.ai");
    // Just before expiry…
    vi.advanceTimersByTime(__testOnly__.cooldownMs - 100);
    expect(isOnCooldown("1.1.1.1", "acquisity.ai")).toBe(true);
    // …a poll should NOT push the expiry forward.
    vi.advanceTimersByTime(200);
    expect(isOnCooldown("1.1.1.1", "acquisity.ai")).toBe(false);
  });

  it("markTriggered evicts entries older than 5x the cooldown window", () => {
    markTriggered("ip1", "old.com");
    expect(__testOnly__.size()).toBe(1);
    // Advance well past the eviction threshold.
    vi.advanceTimersByTime(__testOnly__.cooldownMs * 5 + 1);
    // A fresh write triggers eviction of the stale entry.
    markTriggered("ip2", "new.com");
    expect(__testOnly__.size()).toBe(1);
  });
});
