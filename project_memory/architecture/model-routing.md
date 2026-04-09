# Model Routing Summary

Source: `docs/model-routing.md`

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

For tool-enabled requests sent through OpenAI-compatible providers, AtlasMind also normalizes internal tool ids into OpenAI-safe function names before transmission and maps returned tool calls back to the original Atlas skill ids. This keeps MCP-derived tools usable even when their internal ids contain characters such as `:` or `/` that OpenAI rejects.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

For action-oriented workspace requests, AtlasMind also distinguishes between evidence-gathering and follow-through. Prompts that ask Atlas to wire, integrate, configure, support, or otherwise implement behavior are now biased more aggressively toward direct execution, and after successful read-only evidence gathering AtlasMind issues one stronger follow-through reprompt before accepting a summary-only answer.

AtlasMind also treats prompts about the current project structure, settings pages, or voice and audio settings as workspace-backed investigation requests more aggressively. When a turn has already gathered enough read-only repository evidence, the follow-through nudge now requires exact existing file paths or one final lookup before Atlas is allowed to settle on a summary.

Security prompts such as security gap analysis, runtime-boundary review, auth review, vulnerability review, and threat modeling now bias even more strongly toward live repository evidence. AtlasMind treats those requests as code, configuration, runtime-boundary, and test investigations first, adds explicit prompt guidance that documentation is context rather than the sole source of truth, and prefers source-backed implementation evidence before it summarizes any claimed gap.
If the selected provider fails outright, AtlasMind now attempts a bounded provider failover and reroutes the task to another eligible provider before surfacing a final error.

AtlasMind also includes workstation context in routed prompts so response formatting can default to the active environment, such as preferring 
…(truncated)

<!-- atlasmind-import
entry-path: architecture/model-routing.md
generator-version: 2
generated-at: 2026-04-09T15:56:04.378Z
source-paths: docs/model-routing.md
source-fingerprint: 99cce63e
body-fingerprint: d8c44dc9
-->
