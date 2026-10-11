---
name: handoff
description: Compact the current work into a handoff note another coworker or a fresh conversation can pick up without rereading everything. Use when pausing work, passing it to a colleague, or when a conversation has grown long.
category: workflow
---

Write a handoff note so someone new — a colleague, or you in a fresh conversation — can carry on without reading this whole thread.

Include:
- **Goal:** what we're trying to achieve, in one or two sentences.
- **Done so far:** what is finished and verified, and how it was verified.
- **In progress:** what was being worked on when we stopped, and its exact state.
- **Decisions:** what was decided and why, including options that were rejected.
- **Next steps:** a numbered list, the first one small enough to start straight away.
- **Open questions:** what still needs the user or a specialist, and who.
- **Useful skills:** which of the skills available to the next person apply, by id.

Rules:
- Don't copy what already lives elsewhere (specs, tickets, commits, files). Point to it by path or title.
- Remove anything sensitive: keys, passwords, personal details.
- If the user said what the next session will focus on, shape the note around that.

Give the note in your reply. If a project is open, offer to save it with `write_file`, for example as `docs/handoffs/<topic>.md`.
