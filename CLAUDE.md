# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests (headless)
npx playwright test

# Run all tests with browser visible
npx playwright test --headed

# Run a single spec file
npx playwright test tests/qna-ask-question.spec.ts --headed
npx playwright test tests/qna-teacher-reply.spec.ts --headed

# Open Playwright UI mode (interactive test runner)
npx playwright test --ui

# Show last HTML report
npx playwright show-report
```

## Architecture

This repo automates a two-sided Q&A workflow on a UMS (University Management System):

1. **Student side** (`qna-ask-question.spec.ts`) — logs into the student portal, navigates to a specific Q&A card, and submits questions across every available subject/chapter combination.
2. **Teacher side** (`qna-teacher-reply.spec.ts`) — logs into the teacher portal, navigates to Pending Questions, and answers only the questions that belong to the configured card.

The two specs are intentionally decoupled and chained via a JSON log file:

```
qna-ask-question  →  writes  →  qna.asked.json
qna-teacher-reply →  reads   →  qna.asked.json  (to match which questions to answer)
```

## Data files (`tests/`)

| File | Purpose |
|---|---|
| `qna.testdata.json` | Student portal URL, credentials, target card name, question texts, and teacher type (`human`/`ai`) |
| `qna.teacher.testdata.json` | Teacher portal URL, TPIN/password credentials, target card name, and answer strings keyed by `questionContains` substring |
| `qna.asked.json` | Runtime output — log of every question submitted, grouped by run; consumed by the teacher spec to identify which pending questions to answer |

## Key conventions

- **Card filtering**: Both specs filter activity by `cardName` (e.g. `"Qna Service Three"`). The teacher spec skips any pending question not originating from an asked-question run for that card.
- **Timestamp tagging**: Each submitted question has a `[YYYY-MM-DD HH:MM:SS]` suffix appended before submission so individual runs can be correlated in `qna.asked.json`.
- **Answer matching**: Teacher answers are looked up by `questionContains` substring (case-insensitive) against the visible question text — add a new entry to `qna.teacher.testdata.json` for each new question pattern.
- **"Load More" pagination**: Both specs loop on a "Load More" button to handle paginated lists before declaring no more items.
- **BlockUI wait**: After each submission the specs wait for `.blockUI.blockOverlay` to disappear before proceeding, avoiding race conditions with the portal's loading overlay.
