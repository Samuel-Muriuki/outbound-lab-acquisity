/**
 * Unit tests for the forbidden-phrase regex check.
 *
 * Each pattern from FORBIDDEN_PATTERNS gets at least one positive
 * (matches) and one negative (doesn't trip on close-but-acceptable text)
 * case. Catches regressions where someone tightens or widens a regex
 * accidentally.
 */
import { describe, expect, it } from "vitest";
import {
  findForbiddenPhrase,
  isEmailAcceptable,
  __testOnly__,
} from "./forbidden-phrases";

describe("findForbiddenPhrase()", () => {
  describe("'noticed your company is doing amazing' cliche", () => {
    it("matches the canonical phrasing", () => {
      const hit = findForbiddenPhrase(
        "I noticed your company is doing amazing things in B2B."
      );
      expect(hit?.reason).toMatch(/noticed your company is doing amazing/);
    });

    it("does NOT match unrelated uses of 'noticed'", () => {
      expect(
        findForbiddenPhrase("I noticed your hiring page is updated weekly.")
      ).toBeNull();
    });
  });

  describe("'following your journey' cliche", () => {
    it("matches both spellings ('I've been', 'I have been', 'I')", () => {
      expect(
        findForbiddenPhrase("I've been following your journey on LinkedIn.")
      ).not.toBeNull();
      expect(
        findForbiddenPhrase("I have been following your journey closely.")
      ).not.toBeNull();
      expect(findForbiddenPhrase("I been following your journey.")).not.toBeNull();
    });

    it("does NOT match 'following the company news'", () => {
      expect(findForbiddenPhrase("I've been following the company news.")).toBeNull();
    });
  });

  describe("'hope this email finds you well' cliche", () => {
    it("matches the canonical phrasing and short variants", () => {
      expect(
        findForbiddenPhrase("Hope this email finds you well — quick note.")
      ).not.toBeNull();
      expect(findForbiddenPhrase("Hope this finds you well.")).not.toBeNull();
      expect(findForbiddenPhrase("Hope you are well.")).not.toBeNull();
    });

    it("does NOT match 'hope you have a good week'", () => {
      expect(findForbiddenPhrase("Hope you have a good week.")).toBeNull();
    });
  });

  describe("hyperbole / marketing-speak", () => {
    it("matches incredible / amazing / game-changing / revolutionary / next-gen", () => {
      expect(findForbiddenPhrase("This is an incredible product.")).not.toBeNull();
      expect(findForbiddenPhrase("Such an amazing offer.")).not.toBeNull();
      expect(findForbiddenPhrase("It's a game-changing approach.")).not.toBeNull();
      expect(findForbiddenPhrase("Their game changing strategy.")).not.toBeNull();
      expect(findForbiddenPhrase("A revolutionary platform.")).not.toBeNull();
      expect(findForbiddenPhrase("Next-gen tooling.")).not.toBeNull();
      expect(findForbiddenPhrase("nextgen approach.")).not.toBeNull();
    });

    it("does NOT match 'incredible' as a substring of another word", () => {
      // \b word boundary should prevent partial matches.
      expect(findForbiddenPhrase("incredibility is the test.")).toBeNull();
    });

    it("matches case-insensitively", () => {
      expect(findForbiddenPhrase("AMAZING growth.")).not.toBeNull();
    });
  });

  it("returns null on a clean email body", () => {
    const cleanBody =
      "Hi Tasnim — saw that Acquisity is scaling its TA engine for AI businesses, " +
      "and that you led growth at noon and talabat before this. The pattern that worked " +
      "well in those scaling moments was X. Worth a 15-minute call this week?";
    expect(findForbiddenPhrase(cleanBody)).toBeNull();
    expect(isEmailAcceptable(cleanBody)).toBe(true);
  });

  it("FORBIDDEN_PATTERNS table has the 4 documented patterns", () => {
    expect(__testOnly__.FORBIDDEN_PATTERNS).toHaveLength(4);
  });
});
