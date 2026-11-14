---
name: factory-issues
description: Turn what the user wants built or fixed into GitHub issues the software factory can implement unattended. Interviews the user one question at a time, splits the work into thin end-to-end slices (one behaviour or one endpoint each), writes acceptance criteria, and publishes the issues with the ready-for-agent label. Use when the user wants to hand work to the factory, says "Issue にして", "ファクトリに流して", or describes a feature or bug to build.
---

The factory implements each issue with no human present, so everything the agent needs must be in the issue. Questions get answered here, with the user, not later on GitHub.

### Step 1: Understand the request

Read `CLAUDE.md` and the code the request touches. For a bug, reproduce it or find the code path, and note what you found. If the request needs production logs or data, look at them with the user's own access now and write the findings into the issue: the factory never has that access.

### Step 2: Ask until it is unambiguous

Ask one question at a time, with your recommended answer, until you could write acceptance criteria that a test can check. Stop asking when the remaining choices are ones the agent can make from the code.

### Step 3: Split into slices

Each issue is one thin vertical slice: one user-visible behaviour, usually one endpoint or one screen change, through every layer it needs (table, Server Action, UI, tests). Do not split by layer (migration / domain / UI): a layer-only PR cannot be verified on its own. Split a large endpoint by behaviour instead (minimal happy path, then validation, then errors and permissions). Put a new table in the first slice that uses it. Make slices that share new code depend on the slice that creates it.

Do not ask the user to approve the split; decide it. Mention it briefly so they can object.

### Step 4: Publish

Create each issue with `gh issue create`, blockers first, using this body:

```markdown
## What to build
End-to-end behaviour in Japanese. No file paths or code unless a decision depends on them.

## Acceptance criteria
- [ ] Each criterion checkable by a test or by a described manual check

## Out of scope
- What the agent must not touch

## Blocked by
- #N, or "None"

## Notes
Findings from Step 1 (reproduction, code paths, production observations).
```

Then add the `ready-for-agent` label to the slices the factory should build (`gh issue edit N --add-label ready-for-agent`). Leave a slice unlabelled if it needs a human decision the user has not made yet, and say so.
