# Model Routing Summary

Source: `docs/model-routing.md`

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

For tool-enabled requests sent through OpenAI-compatible providers, AtlasMind also normalizes internal tool ids into OpenAI-safe function names before transmission and maps returned tool calls back to the original Atlas skill ids. This keeps MCP-derived tools usable even when their internal ids contain characters such as `:` or `/` that OpenAI rejects.

AtlasMind now also derives lightweight intent aliases for MCP-backed tools from their names and descriptions. Plain-English prompts such as “commit”, “save changes”, or “show status” are scored against those aliases so the model sees a shortlist of the most likely tools for the current request. When multiple tools score similarly, Atlas explicitly nudges the model to ask the user for clarification instead of guessing.

Anthropic now follows the same compatibility principle for tool-enabled turns. AtlasMind rewrites internal skill ids into provider-safe Anthropic tool names on the wire and restores the original skill ids on returned tool calls, which keeps MCP-backed tools usable even though Anthropic rejects characters such as `:` and `/` in tool names.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

**Correction turns are never downgraded.** When the user's message disputes or corrects the assistant's previous answer (`isUserCorrectionTurn` — e.g. "that's not correct", "no, that's wrong", "you got it wrong", "are you sure?", "re-check that"), AtlasMind treats the turn as high-stakes: it forces the task profile to **high** reasoning, prefers a reasoning-capable model, and escalates the routing budget/speed (`budgetForCorrection`: `cheap → balanced`, otherwise `→ expensive`; speed `→ considered`). This prevents a pushback against a wrong answer from being silently routed to the cheapest/local model — the failure mode where a flaky local model returned an empty completion when challenged.

**Empty completions trigger escalation, not a blank turn.** If the selected model returns a completion with no usable conten
…(truncated)

<!-- atlasmind-import
entry-path: architecture/model-routing.md
generator-version: 2
generated-at: 2026-07-28T12:06:49.103Z
source-paths: docs/model-routing.md
source-fingerprint: f3076239
body-fingerprint: 59de9e31
-->
