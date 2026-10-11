---
name: grilling
description: Interview the user in rounds until a plan, decision or idea has no silent assumptions left. Use when the user wants their thinking stress-tested, or before committing to a plan with open questions.
category: workflow
---

Interview the user until you both share one understanding of the plan. Treat it as a **decision tree**: every decision branches into the decisions that depend on it.

Work in **rounds**. The **frontier** is every open decision whose prerequisites are already settled — the questions you can ask now without guessing at answers you haven't heard. Ask the whole frontier in one round. Number each question and give your recommended answer, then stop and wait.

Format a round like this:

```
**Q1 — <short title>**: <the question, with the options if there are any>

→ Recommended: <your answer and the one-line reason>

**Q2 — <short title>**: ...
```

Each answer reshapes the tree: settled decisions unblock the questions below them. Recompute the frontier and ask the next round. A question that depends on another question still open in this round waits for a later round.

**Facts are your job; decisions are the user's.** Never ask the user for something you can find yourself:
- In the open project, look it up with `read_file`, `list_files` or `search_code`.
- For a specialist's knowledge, ask them with `ask_colleague` (for example the Security Engineer on an auth question), and say who you asked.

Put only real choices to the user.

You are done when the frontier is empty: every branch visited and nothing assumed. Finish with a short numbered summary of what was decided. Do not act on the plan until the user confirms that summary.
