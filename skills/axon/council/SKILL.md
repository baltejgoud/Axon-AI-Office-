---
name: council
description: Settle an ambiguous decision by putting the bare question to up to three colleagues from different fields, then weighing their positions against your own. Use for go/no-go calls, trade-offs and choices with no obvious winner.
category: workflow
---

Convene a small council for a decision where several paths are credible and none is obviously right: build or buy, ship now or hold, one market or two, hire or contract.

Don't use it for factual questions, obvious tasks, or reviewing finished work — just answer or do those.

## 1. Pin down the question

Reduce the decision to one prompt: what is being decided, which constraints matter, and what success looks like. If the question is vague, ask the user one clarifying question first.

## 2. Take your own position first

Before hearing anyone else, write down your position, your three strongest reasons, and the main risk of your preferred path. This stops the synthesis from simply echoing the loudest voice.

## 3. Ask colleagues — with only the question

Use `ask_colleague` (at most three) and pick people who will see the decision differently, for example:
- someone who will **challenge the premise** and propose the simplest alternative (often a senior engineer, an architect, or a strategy manager);
- someone who will **optimise for shipping** and real-world execution (an operations, delivery or product person);
- someone who will look for **downside risk** and how it fails (security, finance, legal-minded or quality roles).

Give each the same compact brief and nothing more — no conversation history. Fresh eyes are the point:

```
We're deciding: <question>
Constraints: <only what matters>
Give me: 1) your position in one or two sentences, 2) three reasons,
3) the biggest risk in what you recommend, 4) one thing others might miss.
```

## 4. Weigh the positions

- Show each colleague's position, named, before your verdict.
- Don't dismiss a view without saying why.
- If a colleague changed your mind, say so.
- If two colleagues agree against your first position, treat that as a real signal.
- Always include the strongest dissent, even if you reject it.

## 5. Give the verdict

End with: the **decision** you recommend, **why** in three bullets, the **strongest dissent**, the **risk you're accepting**, and the **signal that would make you revisit it**.
