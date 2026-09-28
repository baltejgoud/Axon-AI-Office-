---
name: to-questionnaire
description: Turn a decision the user can't make alone into a questionnaire for the person who holds the missing knowledge. Use when an answer depends on someone else — a client, a team lead, legal or finance.
category: content
---

Turn what the user can't answer alone into a **questionnaire**: a document they send to one person to fill in, or go through together in a meeting. The recipient knows something the user doesn't; the questionnaire draws it out.

**Interview the user about the send, not the subject.** They can always tell you who it's for and what they need back. The questions in the document then aim at the **gap** between what the recipient knows and what the user needs.

1. **Who is it going to?** In one exchange, ask for the recipient's role, expertise and relationship to the user. That sets the tone and how much context the document must carry.
2. **What do you need back?** In one exchange, ask for the specific decisions or facts the user needs from this person.
3. **Write it.** Draft questions aimed at that gap, using the structure below. Give it in your reply; if a project is open, offer to save it with `write_file` as `questionnaire-<topic>.md`. Check every item from step 2 has a question.

## Structure

Order questions most important first — async answers may come back only once. Group them under headings by theme once there are more than a handful.

```
# <Title>

**Purpose:** why this exists and the decision riding on it.
**From:** <user>  **To:** <recipient>  **How your answers will be used:** <where they go>

## Context
One paragraph that orients someone who wasn't in the user's head.

## How to answer
Deadline and rough effort. Partial answers and "I don't know" are useful — flag uncertainty rather than skipping.

## <Theme>
### <One question, one idea>
_Why this matters: <only when it could be misread or brushed off>_
>

## Anything else?
Anything we didn't ask that we should know?
```
