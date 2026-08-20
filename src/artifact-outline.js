// Pure outline + decision-progress helpers shared by the injected artifact SDK and
// the chrome. The SDK ships them to the browser by serializing each one with
// `.toString()` (see `createSdkJs`), which drops the surrounding module scope - so a
// helper may reference only its own arguments, browser globals, or its sibling
// exports from this module. `createSdkJs` re-declares every export here as a
// same-scope `const` before invoking the SDK, so cross-helper calls resolve in the
// browser exactly as they do here; never close over anything else.
//
// Keeping the logic here - instead of inside the `createArtifactSdk` closure - lets
// us unit test the outline shape and the honesty rules directly, without a browser.

export function isOutlineExcluded(el) {
  // Headings inside Lavish's own UI, a diagram, or a whiteboard frame are not
  // document structure - the layout audit excludes the same surfaces for the same
  // reason: they are chrome or canvas, not prose the reader navigates.
  return Boolean(el?.closest?.(".mermaid,svg,[data-lavish-ui]"));
}

// A heading's visible text, collapsed to one line. Mirrors the SDK's own text
// normalization so a section reads in the bar exactly as it reads on the page.
export function readHeadingText(el) {
  const raw = String(el?.innerText || el?.textContent || "");
  return raw.trim().replace(/\s+/g, " ").slice(0, 160);
}

// Heading levels in real artifacts are not monotonic - the repo's own marketing page
// runs h2 -> h4 -> h3. Rather than trust the raw tag depth, we rank the levels that
// actually appear and map them onto contiguous indent tiers, so the dropdown always
// nests sensibly even when the source skips or reorders levels.
export function normalizeOutlineDepths(entries) {
  const levels = [...new Set(entries.map((entry) => entry.level))].sort((a, b) => a - b);
  const rank = new Map(levels.map((level, index) => [level, index]));
  return entries.map((entry) => ({ ...entry, depth: Math.min(rank.get(entry.level) ?? 0, 3) }));
}

// Collect the artifact's heading structure. Empty headings and Lavish/diagram surfaces
// are skipped; everything else is reported in document order with the selector the
// chrome hands back to `lavish:revealElement` to scroll there.
export function collectOutlineEntries(root, selectorFor) {
  const entries = [];
  const headings = root?.querySelectorAll?.("h1,h2,h3,h4,h5,h6") || [];
  for (const el of headings) {
    if (entries.length >= 300) break;
    if (isOutlineExcluded(el)) continue;
    const text = readHeadingText(el);
    if (!text) continue;
    const selector = String(selectorFor?.(el) || "");
    // The selector builder caps its path at a few ancestors, so a deeply nested
    // heading can produce a fragment that resolves to a different element. A jump
    // that lands on the wrong section is worse than a missing entry, so keep only
    // selectors that resolve back to the heading they were built from.
    if (!selector || !resolvesTo(root, selector, el)) continue;
    entries.push({ level: Number(String(el.tagName || "h2").slice(1)) || 2, text, selector });
  }
  return normalizeOutlineDepths(entries);
}

// True when a selector resolves back to the element it was derived from. A selector
// engine throw (an unescapable id, say) is treated as "not resolvable" rather than
// propagating, so one odd heading cannot fail the whole scan.
export function resolvesTo(root, selector, el) {
  try {
    return root?.querySelector?.(selector) === el;
  } catch {
    return false;
  }
}

// The questions the SDK can actually see. This is deliberately narrow: only explicit
// `[data-lavish-question]` scopes count, because that attribute is the one thing an
// artifact does that unambiguously declares "this is a decision". A decision written
// only as prose is invisible here and must never be implied by the count.
export function collectOutlineQuestions(root) {
  const counts = new Map();
  const scopes = root?.querySelectorAll?.("[data-lavish-question]") || [];
  for (const scope of scopes) {
    if (isOutlineExcluded(scope)) continue;
    const key = String(scope.getAttribute?.("data-lavish-question") || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const questions = [];
  for (const [key, count] of counts) {
    // A key used by two blocks is not two trackable decisions: their submits collide
    // on one queue key, so answering the second silently replaces the first. Counting
    // it once would tell the reader they were done while a block sat unanswered, so
    // an ambiguous key is not tracked at all rather than tracked wrongly.
    if (count > 1) continue;
    questions.push({ key });
    if (questions.length >= 300) break;
  }
  return questions;
}

// A queued prompt answers a question only when its queue key says so. The SDK derives
// `question:<key>` for a prompt raised from inside a question scope, and the annotation
// card explicitly opts out with `queueKey: ""` - so an annotation on prose inside a
// question wrapper can never be mistaken for a submitted answer.
export function questionKeyFromQueueKey(queueKey) {
  const raw = String(queueKey || "");
  return raw.startsWith("question:") ? raw.slice("question:".length).trim() : "";
}

// Decision progress, computed only from evidence the chrome owns.
//
// `answeredKeys` is the chrome's own record of questions that have been submitted -
// it survives a send, because a queued prompt is spliced out of the queue once it
// reaches the agent. It is NOT read from the DOM: a radio the authoring agent
// pre-checked as its recommended option would otherwise report an answer the reader
// never gave. Selected is not answered; only an explicit submit counts.
//
// Returns null when there is nothing honest to say - no visible questions at all -
// so the chrome renders no counter rather than a meaningless `0/0`.
export function summarizeDecisionProgress(questions, answeredKeys) {
  const total = Array.isArray(questions) ? questions.length : 0;
  if (!total) return null;
  const answered = new Set(answeredKeys || []);
  const items = questions.map((question) => ({
    key: question.key,
    answered: answered.has(question.key),
  }));
  return { total, answered: items.filter((item) => item.answered).length, items };
}

// Whether the bar earns its vertical space. A short document that fits on one screen
// is already navigable, and a single heading is a title rather than a structure - but
// a tracked decision is worth surfacing at any length, because the reader needs to
// know something is waiting on them.
export function shouldShowOutlineBar({ entries, questions, scrollRatio }) {
  const sections = Array.isArray(entries) ? entries.length : 0;
  const decisions = Array.isArray(questions) ? questions.length : 0;
  if (decisions > 0) return true;
  // One heading is a title, not a structure to move around in.
  if (sections < 2) return false;
  // Below roughly 1.6 screens the bar costs more than it returns: the document is
  // already navigable by scrolling.
  return !(Number.isFinite(scrollRatio) && scrollRatio < 1.6);
}

// The section the reader is in. The SDK reports which headings are above the fold via
// IntersectionObserver rather than recomputing offsets on every scroll frame; this
// picks the last heading that has passed the top, falling back to the first section
// so the bar always names something once an outline exists.
export function activeOutlineIndex(entries, passedIndices) {
  if (!Array.isArray(entries) || !entries.length) return -1;
  const passed = (passedIndices || []).filter((index) => index >= 0 && index < entries.length);
  if (!passed.length) return 0;
  return Math.max(...passed);
}
