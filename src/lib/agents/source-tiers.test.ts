/**
 * Unit tests for the source-tier classifier.
 */
import { describe, expect, it } from "vitest";
import {
  classifyTier,
  highestTier,
  __testOnly__,
} from "./source-tiers";

describe("classifyTier()", () => {
  describe("first-party (target's own domain)", () => {
    it("classifies the target's exact domain as HIGH", () => {
      expect(
        classifyTier("https://acquisity.ai/team", { targetDomain: "acquisity.ai" })
      ).toBe("high");
    });

    it("classifies www.target as HIGH (www. stripped)", () => {
      expect(
        classifyTier("https://www.acquisity.ai/team", { targetDomain: "acquisity.ai" })
      ).toBe("high");
    });

    it("classifies a subdomain of the target as HIGH", () => {
      expect(
        classifyTier("https://blog.acquisity.ai/post", { targetDomain: "acquisity.ai" })
      ).toBe("high");
    });

    it("does NOT classify a similar-but-different domain as HIGH", () => {
      // acquisition.com vs acquisity.ai — different companies entirely.
      expect(
        classifyTier("https://acquisition.com/team", { targetDomain: "acquisity.ai" })
      ).toBe("low");
    });
  });

  describe("HIGH curated hosts", () => {
    it.each([
      "https://www.linkedin.com/in/jaredpstauffer",
      "https://crunchbase.com/organization/linear",
      "https://bloomberg.com/news/articles/2026/05/foo",
      "https://reuters.com/article/foo",
      "https://techcrunch.com/2026/04/post",
      "https://forbes.com/2026/05/foo",
      "https://wsj.com/articles/foo",
      "https://nytimes.com/foo",
      "https://www.ycombinator.com/library/Mk-foo",
    ])("classifies %s as HIGH", (url) => {
      expect(classifyTier(url)).toBe("high");
    });
  });

  describe("MEDIUM curated hosts", () => {
    it.each([
      "https://medium.com/@author/post",
      "https://dev.to/author/post",
      "https://github.com/foo/bar",
      "https://author.substack.com/p/post",
      "https://newsletter.pragmaticengineer.com/p/linear",
    ])("classifies %s as MEDIUM", (url) => {
      expect(classifyTier(url)).toBe("medium");
    });
  });

  describe("LOW default (everything else)", () => {
    it.each([
      "https://wikigenius.org/article/founders",
      "https://acquisity-fans.fandom.com/wiki/CEO",
      "https://generic-seo-blog.example.com/post",
      "https://contentfarm.example/article",
    ])("classifies %s as LOW", (url) => {
      expect(classifyTier(url)).toBe("low");
    });

    it("returns LOW on unparseable URLs", () => {
      expect(classifyTier("not a url")).toBe("low");
      expect(classifyTier("")).toBe("low");
    });
  });

  it("matches subdomains of curated HIGH hosts (e.g. es.linkedin.com)", () => {
    // i18n LinkedIn subdomains should still classify as HIGH.
    expect(classifyTier("https://es.linkedin.com/in/tuomasartman")).toBe("high");
    expect(classifyTier("https://uk.linkedin.com/in/foo")).toBe("high");
  });
});

describe("highestTier()", () => {
  it("returns 'high' if any URL is HIGH", () => {
    expect(
      highestTier([
        "https://generic-blog.example",
        "https://medium.com/@author/post",
        "https://linkedin.com/in/foo",
      ])
    ).toBe("high");
  });

  it("returns 'medium' if no HIGH but at least one MEDIUM", () => {
    expect(
      highestTier([
        "https://generic-blog.example",
        "https://medium.com/@author/post",
      ])
    ).toBe("medium");
  });

  it("returns 'low' when all URLs are uncurated", () => {
    expect(
      highestTier([
        "https://generic-blog.example",
        "https://contentfarm.example",
      ])
    ).toBe("low");
  });

  it("returns 'low' on empty input", () => {
    expect(highestTier([])).toBe("low");
  });

  it("treats target-domain URLs as HIGH via options pass-through", () => {
    expect(
      highestTier(
        ["https://acquisity.ai/team", "https://generic-blog.example"],
        { targetDomain: "acquisity.ai" }
      )
    ).toBe("high");
  });
});

it("HIGH and MEDIUM lists don't overlap", () => {
  const high = __testOnly__.HIGH_HOSTS;
  const medium = __testOnly__.MEDIUM_HOSTS;
  for (const h of high) {
    expect(medium.has(h)).toBe(false);
  }
});
