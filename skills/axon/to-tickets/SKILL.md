---
name: to-tickets
description: Break a plan, spec or conversation into thin end-to-end tickets, each naming the tickets that block it. Use when the user wants work split into tasks, stories or a delivery plan.
category: workflow
---

Break the work into **tickets**: thin vertical slices, each naming the tickets that **block** it.

## Process

1. **Gather context.** Work from the conversation. If the user points at a spec or document in the open project, read it in full.
2. **Look at the code** if a project is open and you haven't yet. Use its vocabulary in ticket titles. Look for **prefactoring** that would make the change easy — "make the change easy, then make the easy change" — and put it first.
3. **Draft vertical slices.**
   - Each slice cuts a narrow but complete path through every layer (data, API, UI, tests): vertical, not one layer at a time.
   - A finished slice can be demonstrated or verified on its own.
   - Each slice is small enough for one focused working session.
   - A **wide refactor** (one mechanical change that breaks callers everywhere, such as renaming a shared field) is the exception. Sequence it as expand → migrate in batches → contract: add the new form beside the old, move callers over batch by batch, then delete the old form once nothing uses it.
4. **Check with the user.** Show the breakdown as a numbered list. For each ticket give the **title**, what it's **blocked by**, and **what it delivers** end to end. Ask whether the granularity is right, whether each blocking edge is real, and whether anything should be merged or split. Revise until they approve.
5. **Deliver.** Give the approved tickets in your reply, blockers first, using the template below. If a project is open, offer to save them with `write_file` as one Markdown file per ticket under `docs/tickets/<feature>/NN-<slug>.md`. If the user wants them on their to-do list, suggest they ask the Receptionist, who keeps it.

Work starts at the **frontier**: every ticket whose blockers are done.

## Ticket template

```
## NN — <title>
Blocked by: <ticket numbers, or "nothing">

What it delivers: <the end-to-end behaviour this ticket makes work>

Done when:
- <an observable check>
- <a test that proves it>
```
