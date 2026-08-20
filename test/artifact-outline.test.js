import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOutlineIndex,
  collectOutlineEntries,
  collectOutlineQuestions,
  normalizeOutlineDepths,
  questionKeyFromQueueKey,
  readHeadingText,
  shouldShowOutlineBar,
  summarizeDecisionProgress,
} from "../src/artifact-outline.js";

// Minimal element stand-ins. The helpers only ever touch tagName, text, closest and
// getAttribute, so modelling those directly keeps these tests browser-free.
function fakeHeading(tag, text, { excluded = false } = {}) {
  return {
    tagName: tag.toUpperCase(),
    textContent: text,
    closest: () => (excluded ? {} : null),
  };
}

/** @param {{ resolve?: (selector: string) => any }} [options] */
function fakeRoot(headings, scopes = [], options = {}) {
  const resolve = options.resolve;
  return {
    querySelectorAll: (selector) => (selector === "[data-lavish-question]" ? scopes : headings),
    // Default to honest resolution: each heading's selector finds that heading.
    querySelector: (selector) => (resolve ? resolve(selector) : headings.find((h) => h.__sel === selector)),
  };
}

function fakeScope(key, { excluded = false } = {}) {
  return {
    getAttribute: () => key,
    closest: () => (excluded ? {} : null),
  };
}

test("readHeadingText collapses whitespace to a single line", () => {
  // Arrange
  const heading = fakeHeading("h2", "  Four\n  findings  ");

  // Act
  const text = readHeadingText(heading);

  // Assert
  assert.equal(text, "Four findings");
});

test("collectOutlineEntries returns headings in document order with jump selectors", () => {
  // Arrange
  const headings = [fakeHeading("h1", "Title"), fakeHeading("h2", "Findings")];
  const root = fakeRoot(headings);

  // Act
  headings.forEach((h) => (h.__sel = h.tagName.toLowerCase()));
  const entries = collectOutlineEntries(root, (el) => el.tagName.toLowerCase());

  // Assert
  assert.deepEqual(
    entries.map((entry) => [entry.text, entry.selector, entry.depth]),
    [
      ["Title", "h1", 0],
      ["Findings", "h2", 1],
    ],
  );
});

test("collectOutlineEntries skips empty headings and Lavish or diagram surfaces", () => {
  // Arrange
  const headings = [
    fakeHeading("h2", "Kept"),
    fakeHeading("h2", "   "),
    fakeHeading("h2", "Inside a diagram", { excluded: true }),
  ];

  // Act - every heading claims the same selector, resolved to whichever asks.
  const root = fakeRoot(headings, [], { resolve: () => headings[0] });
  const entries = collectOutlineEntries(root, () => "sel");

  // Assert
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["Kept"],
  );
});

test("collectOutlineEntries drops headings with no resolvable selector", () => {
  // Arrange
  const headings = [fakeHeading("h2", "Unreachable")];

  // Act
  const entries = collectOutlineEntries(fakeRoot(headings), () => "");

  // Assert
  assert.deepEqual(entries, []);
});

// Real artifacts skip and reorder levels - the repo's own marketing page runs
// h2 -> h4 -> h3 - so indentation must come from the levels that actually appear.
test("normalizeOutlineDepths maps non-monotonic levels onto contiguous tiers", () => {
  // Arrange
  const entries = [
    { level: 2, text: "A" },
    { level: 4, text: "B" },
    { level: 3, text: "C" },
  ];

  // Act
  const normalized = normalizeOutlineDepths(entries);

  // Assert
  assert.deepEqual(
    normalized.map((entry) => entry.depth),
    [0, 2, 1],
  );
});

test("collectOutlineQuestions reports each unambiguous question and skips blank keys", () => {
  // Arrange
  const scopes = [fakeScope("plan"), fakeScope("rollout"), fakeScope("  ")];

  // Act
  const questions = collectOutlineQuestions(fakeRoot([], scopes));

  // Assert
  assert.deepEqual(
    questions.map((question) => question.key),
    ["plan", "rollout"],
  );
});

test("questionKeyFromQueueKey reads only question-scoped queue keys", () => {
  // Act & Assert - the annotation card queues with an empty key, so an annotation
  // raised inside a question wrapper can never register as a submitted answer.
  assert.equal(questionKeyFromQueueKey("question:plan"), "plan");
  assert.equal(questionKeyFromQueueKey(""), "");
  assert.equal(questionKeyFromQueueKey("radio:form:plan"), "");
});

test("summarizeDecisionProgress counts only explicitly answered questions", () => {
  // Arrange
  const questions = [{ key: "plan" }, { key: "rollout" }, { key: "owner" }];

  // Act
  const progress = summarizeDecisionProgress(questions, ["plan", "owner"]);

  // Assert
  assert.equal(progress.total, 3);
  assert.equal(progress.answered, 2);
  assert.deepEqual(
    progress.items.map((item) => item.answered),
    [true, false, true],
  );
});

// The honesty invariant: a pre-checked "recommended" default is selection, not an
// answer. Progress is computed from the chrome's record of submissions only, so a
// document nobody has touched must report zero.
test("summarizeDecisionProgress reports zero when nothing has been submitted", () => {
  // Arrange
  const questions = [{ key: "plan" }, { key: "rollout" }];

  // Act
  const progress = summarizeDecisionProgress(questions, []);

  // Assert
  assert.equal(progress.answered, 0);
  assert.equal(progress.total, 2);
});

test("summarizeDecisionProgress returns null when no questions are visible", () => {
  // Act & Assert - no counter at all beats a meaningless 0/0.
  assert.equal(summarizeDecisionProgress([], ["plan"]), null);
});

test("shouldShowOutlineBar hides the bar for a short single-screen document", () => {
  // Act & Assert
  assert.equal(shouldShowOutlineBar({ entries: [{}, {}, {}], questions: [], scrollRatio: 1.1 }), false);
});

test("shouldShowOutlineBar hides the bar when there is no real structure", () => {
  // Act & Assert - one heading is a title, not a structure to navigate.
  assert.equal(shouldShowOutlineBar({ entries: [{}], questions: [], scrollRatio: 12 }), false);
  assert.equal(shouldShowOutlineBar({ entries: [], questions: [], scrollRatio: 12 }), false);
});

test("shouldShowOutlineBar shows the bar for a long multi-section document", () => {
  // Act & Assert
  assert.equal(shouldShowOutlineBar({ entries: [{}, {}, {}], questions: [], scrollRatio: 6 }), true);
});

test("shouldShowOutlineBar shows the bar for a tracked decision at any length", () => {
  // Act & Assert - a decision waiting on the reader is worth the row even on a
  // short page with no headings at all.
  assert.equal(shouldShowOutlineBar({ entries: [], questions: [{ key: "plan" }], scrollRatio: 1 }), true);
});

test("activeOutlineIndex tracks the last heading scrolled past", () => {
  // Arrange
  const entries = [{}, {}, {}];

  // Act & Assert
  assert.equal(activeOutlineIndex(entries, [0, 1]), 1);
  assert.equal(activeOutlineIndex(entries, []), 0);
  assert.equal(activeOutlineIndex([], [0]), -1);
});

test("activeOutlineIndex ignores indices outside the current outline", () => {
  // Act & Assert - a stale observer callback must not select a removed section.
  assert.equal(activeOutlineIndex([{}, {}], [0, 9]), 0);
});

// `src/chrome-client.js` is served as a raw file and cannot import modules, so it
// carries its own copies of three helpers from this module. Duplication that drifts
// silently is the real hazard, so pin the behavior of both copies to one table.
test("the chrome client's inlined outline helpers match this module", async () => {
  // Arrange
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/chrome-client.js", import.meta.url), "utf8");
  // indexOf returns -1 on a miss, which would silently slice garbage and surface as a
  // confusing SyntaxError instead of "the anchors moved". Fail on the real cause.
  const start = source.indexOf("function questionKeyFromQueueKey");
  const end = source.indexOf("function loadAnsweredQuestions");
  assert.ok(start >= 0 && end > start, "outline helper markers moved in chrome-client.js - update these slice anchors");
  const window = source.slice(start, end);

  const pinned = ["questionKeyFromQueueKey", "summarizeDecisionProgress", "shouldShowOutlineBar"];
  // The SDK seam derives its declarations from the module's exports, so a new helper
  // cannot silently go unserialized. This seam is hand-inlined, so assert the set too:
  // a fourth copy added inside this window would otherwise pass while pinning nothing.
  const mirrored = [...window.matchAll(/^function (\w+)\(/gm)].map((match) => match[1]);
  assert.deepEqual(
    mirrored.filter((name) => !pinned.includes(name)),
    [],
    "a hand-inlined helper in chrome-client.js has no drift case pinning it",
  );

  const context = {};
  const factory = new Function("exports", window + pinned.map((name) => `exports.${name} = ${name};`).join(""));
  factory(context);

  const cases = [
    ["questionKeyFromQueueKey", ["question:plan"]],
    ["questionKeyFromQueueKey", ["radio:form:plan"]],
    ["questionKeyFromQueueKey", [""]],
    ["summarizeDecisionProgress", [[{ key: "a" }, { key: "b" }], ["a"]]],
    ["summarizeDecisionProgress", [[], ["a"]]],
    ["shouldShowOutlineBar", [{ entries: [], questions: [{ key: "a" }], scrollRatio: 1 }]],
    ["shouldShowOutlineBar", [{ entries: [{}], questions: [], scrollRatio: 9 }]],
    // Sweep the scroll-ratio and section-count thresholds densely rather than
    // sampling a few far-apart values: a sparse table agrees on both sides of a
    // moved threshold, which is exactly the drift most likely to be introduced.
    ...[0, 0.5, 1, 1.5, 1.59, 1.6, 1.61, 2, 2.5, 3, 5, 9, 40].flatMap((scrollRatio) =>
      [0, 1, 2, 3].map((count) => [
        "shouldShowOutlineBar",
        [{ entries: Array.from({ length: count }, () => ({})), questions: [], scrollRatio }],
      ]),
    ),
  ];

  // Act & Assert
  const module = { questionKeyFromQueueKey, summarizeDecisionProgress, shouldShowOutlineBar };
  for (const [name, args] of cases) {
    assert.deepEqual(
      context[name](...args),
      module[name](...args),
      `${name}(${JSON.stringify(args)}) drifted between chrome-client.js and artifact-outline.js`,
    );
  }
});

// A key shared by two blocks is not two trackable decisions: both submits collide on
// one queue key, so the second silently replaces the first. Counting it once would
// report "all answered" while a block sat unanswered.
test("collectOutlineQuestions does not track an ambiguous duplicated question key", () => {
  // Arrange
  const scopes = [fakeScope("plan"), fakeScope("plan"), fakeScope("rollout")];

  // Act
  const questions = collectOutlineQuestions(fakeRoot([], scopes));

  // Assert
  assert.deepEqual(
    questions.map((question) => question.key),
    ["rollout"],
  );
});

// The SDK's selector builder caps its ancestor path, so a deeply nested heading can
// yield a fragment that matches an earlier element. Jumping to the wrong section is
// worse than omitting the entry.
test("collectOutlineEntries drops a heading whose selector resolves elsewhere", () => {
  // Arrange - both headings claim "h2"; it resolves to the first one only.
  const headings = [fakeHeading("h2", "First"), fakeHeading("h2", "Shadowed")];
  const root = fakeRoot(headings, [], { resolve: () => headings[0] });

  // Act
  const entries = collectOutlineEntries(root, () => "h2");

  // Assert
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["First"],
  );
});
