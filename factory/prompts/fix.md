# Task

You are an unattended agent fixing the branch `{{BRANCH}}` for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}.
This is fix round {{ROUND}}. The factory found the problems below. Fix them, nothing else.

# Issue

{{ISSUE_BODY}}

# Problems to fix

{{PROBLEMS}}

# Latest verify output (tail)

```
{{VERIFY_OUTPUT}}
```

# How to work

1. Read `CLAUDE.md` and the current diff (`git diff origin/{{BASE}}...HEAD`).
2. For each problem: fix it, or decide it is not a real problem. You may decline a review finding only with a concrete reason (for example, the trigger it describes cannot happen, with the code that proves it).
3. Run `pnpm verify` until it passes.
4. Commit with conventional commit messages.

# Rules

Same as implementation: no push, no labels, no PRs, no `.env*`, no new dependencies, and do not edit `factory/**`, `.github/**`, `package.json`, `pnpm-lock.yaml`, `supabase/migrations/**`, `terraform/**` unless the issue asks for it.

# Output

- `summary`: what you changed, in Japanese
- `responses`: one entry per problem: `fixed` or `not_fixed`, with the reason in Japanese
