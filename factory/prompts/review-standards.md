Check that the PR follows this repository's documented rules and existing patterns.

- Read `CLAUDE.md` and follow its rules: Server Components by default, `'use client'` only where interactive, Server Actions in `src/actions/`, `useActionState` for forms, mobile first with 44px touch targets, all UI text in Japanese, no emoji, 「ごはん」 instead of 「フード」 in UI text.
- New code should look like the code next to it: naming, file placement, how existing components and utilities are reused instead of duplicated.
- Tests: new logic in `src/lib/` has Vitest tests next to it; tests assert behaviour, not implementation details.
- Comments explain why, not what.

Severity guide for this perspective: breaking a documented rule that users would see (UI wording, emoji, touch targets) is `high`; other rule breaks are `medium`; taste is not a finding.
