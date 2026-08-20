# Sticky section bar - before/after evidence

Task: make long artifacts navigable from the editor chrome. A thin sticky row under the header
names the section you are in, lists every section behind a dropdown, and - when the artifact
declares decisions - reports how many have actually been answered.

All screenshots were captured from the real browser through the real `lavish-axi` flow (served
chrome + sandboxed artifact iframe), driven by the CLI, not from a mock. BEFORE and AFTER use the
same artifact at the same window size and the same scroll offset, so the only difference is the
change itself.

The artifact is a ~13-section migration review with three `data-lavish-question` decision blocks
and a 5-across stat-tile row, chosen because the tile row is the layout most sensitive to any
horizontal cost.

## BEFORE

- `before-mid-document-1440x900.png` - scrolled 1500px into the document. Nothing names the
  current section, nothing indicates how much is left, and the three decisions are invisible from
  here. This is the problem being solved.

## AFTER

- `after-mid-document-1440x900.png` - the same artifact, same 1500px offset. The bar names
  "Rollout plan" and reports `1/3` decisions answered. The bar is pinned directly under the
  header and stays there while the artifact scrolls beneath it.
- `after-top-tiles-5-across-1440x900.png` - top of the document. **The stat tiles still lay out
  5-across.** The artifact frame measures 1080px wide with the bar present, identical to BEFORE:
  a top row costs vertical space once and zero horizontal, which is why it is a row and not a
  left rail.
- `after-section-dropdown-1440x900.png` - the section list. All 13 headings in document order,
  indented by the levels the document actually uses, with the current section marked in brass.
  Choosing one scrolls the sandboxed iframe to that heading.
- `after-narrow-600x900-dropdown.png` - at phone width the progress dots drop out and the count
  carries the state alone; the dropdown spans the viewport instead of hanging off its trigger.

## The decision counter is honest - this is the part worth checking

The counter reports a decision as answered **only when the reader explicitly submitted it**.
Selection is not an answer: `src/playbooks.js` tells authoring agents to keep selection state
local until an explicit submit, and nothing stops an agent from pre-checking its recommended
option. A counter that read `:checked` from the DOM would report `3/3` on a page nobody touched.

- `after-selected-but-unanswered-0of3.png` - **all three radios are visibly selected** and the
  counter still reads `0/3` with three hollow dots. A DOM-reading implementation fails here.
- `after-two-answered-2of3.png` - after pressing "Queue this answer" on two of them: `2/3`, two
  brass dots, one hollow, and the action's tooltip reads "1 decision still open".

Answered-ness is tracked in the chrome from queued prompts whose queue key is `question:<key>`
(derived by `deriveLavishQueueKey`), persisted per session. It survives delivery to the agent,
because a sent prompt is spliced out of the queue. The annotation card queues with an explicit
empty queue key, so annotating prose inside a question block never counts as answering it.

The denominator counts only explicit `[data-lavish-question]` scopes. A decision written as prose
is invisible to the shell and is deliberately not counted or implied; when an artifact declares no
questions at all, no counter renders rather than a meaningless `0/0`.

## Reproduce

Open any multi-section artifact with `lavish-axi <file>`. The bar appears when the document has at
least two headings and runs longer than roughly 1.6 screens, or whenever it declares a decision -
short single-screen documents are already navigable and get no bar.

`test/artifact-outline.test.js` and the section-bar tests in `test/chrome-client-queue.test.js`
cover the lifecycle, including the selected-is-not-answered invariant and the counter surviving a
send.
