Look for security problems the PR introduces. This app is Next.js (App Router, Server Actions) on Supabase with Row Level Security.

Check:
- Authorization: every Server Action that reads or writes user data checks `auth.getUser()` and ownership, and does not rely on client input for identity. RLS is the second line, not the only one.
- Data exposure: personal data (email, cat records of other users, service-role results) reaching the client, logs, URLs or public pages. `src/lib/supabase/admin.ts` (service role) must only be used for data that is meant to be public.
- Query construction: user input interpolated into PostgREST filter strings (`.or(...)`, `.filter(...)`) or SQL without escaping.
- Secrets: keys or tokens in code, new `NEXT_PUBLIC_` variables that should be server-only.
- Redirects and links built from user input.

Do not flag: missing rate limiting or DoS concerns, theoretical issues with no input path you can show, or problems in code this PR did not change.
