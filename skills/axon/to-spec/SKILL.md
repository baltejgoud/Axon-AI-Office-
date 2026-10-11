---
name: to-spec
description: Turn what has already been discussed into a written spec — problem, solution, user stories, decisions, tests and scope — without re-interviewing the user. Use when the user asks for a spec, PRD or requirements document.
category: workflow
---

Write a spec from what you already know: this conversation and, when a project is open, the code. Do not interview the user again. If something essential is still undecided, list it under **Open questions** instead of guessing.

## Process

1. If a project is open and you haven't looked yet, look now (`list_files`, `search_code`, `read_file`). Use the project's own vocabulary, and respect decisions already recorded in its docs.
2. Find the **seams** where the feature will be tested. Prefer seams that already exist, and prefer the highest one — ideally a single seam. Check with the user that these match what they expect.
3. Write the spec with the template below.
4. Deliver it in your reply. If a project is open, offer to save it as a Markdown file (for example `docs/specs/<feature>.md`) with `write_file`; the user approves the write.

## Template

```
# <Feature name>

## Problem
The problem the user faces, from their point of view.

## Solution
The solution, from the user's point of view.

## User stories
A long, numbered list covering every part of the feature:
1. As a <actor>, I want <capability>, so that <benefit>.

## Decisions
Modules built or changed and their interfaces, schema changes, API contracts, notable interactions and architectural choices. No file paths or code snippets — they go stale. (Exception: a small snippet from a prototype that pins a decision better than prose, such as a state machine or a type shape.)

## Testing
What makes a good test here (external behaviour, not internals), which modules get tests, and similar tests already in the project to copy.

## Out of scope
What this spec deliberately leaves out.

## Open questions
Anything still undecided, with who can decide it.
```
