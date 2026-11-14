Check that the PR does what the issue asks, completely and nothing more.

- List every acceptance criterion from the issue in `acceptance`, in order, word for word.
- For each, set `met` only if you can point at proof: a test that exercises it (name it and say what it asserts), or code you traced end to end. "Looks implemented" is not proof; leave `evidence` empty and `met` false in that case.
- A criterion that is about UI and cannot be proven by a test may be met by code you traced, but say so in `evidence`.
- Report as `high` findings: a criterion that is not met, a test that would pass even if the feature were broken, and changes outside the issue's scope or in its "Out of scope" list.

Do not flag style, security or architecture here.
