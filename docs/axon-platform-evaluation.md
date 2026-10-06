# Axon Platform Evaluation

## Verified Observations

- Five new free OpenRouter models answered setup tests in **0.8‑1.0 s**.
- Free endpoints still hit request limits.
- North Mini Code repeated `read_file` until the step limit and Axon showed **Completed** without an edit.
- Nemotron repeatedly retrieved shortened tool output.
- `Stop` returned control to the user.
- **Project selection and code work surfaces were usable after asynchronous loading**.
- Chrome required an opt‑in local desktop bridge.
- Animated office interactions sometimes took seconds.

## Prioritized Fixes (in order of importance)

1. **Honest incomplete/cancelled status** – clearly indicate when a task was stopped or did not finish.
2. **Retrieval without recursively summarizing the retrieved slice** – return raw results instead of nested summaries.
3. **Repeated‑tool detection** – detect and break loops where the same tool is invoked repeatedly.
4. **Rate‑limit‑aware model fallback restricted to free models** – avoid hitting limits by gracefully switching to another free model.
5. **Chat‑first accessible UI with reduced background rendering** – improve keyboard/screen‑reader navigation and lower visual load.

## Comparison

This session tested Axon only, not ChatGPT or Claude. Comparison criteria for ChatGPT/Claude‑style usability are immediate conversational entry, responsive keyboard and pointer controls, visible progress and real cancellation, trustworthy completion status, usable file/terminal tools, and clear model availability/cost. Axon offers provider choice and an office metaphor, but this session exposed tool loops, shortened retrieval, and delayed UI.
