# Model Routing Summary

Source: `docs/model-routing.md`

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

For tool-enabled requests sent through OpenAI-compatible providers, AtlasMind also normalizes internal tool ids into OpenAI-safe function names before transmission and maps returned tool calls back to the original Atlas skill ids. This keeps MCP-derived tools usable even when their internal ids contain characters such as `:` or `/` that OpenAI rejects.

AtlasMind now also derives lightweight intent aliases for MCP-backed tools from their names and descriptions. Plain-English prompts such as “commit”, “save changes”, or “show status” are scored against those aliases so the model sees a shortlist of the most likely tools for the current request. When multiple tools score similarly, Atlas explicitly nudges the model to ask the user for clarification instead of guessing.

Anthropic now follows the same compatibility principle for tool-enabled turns. AtlasMind rewrites internal skill ids into provider-safe Anthropic tool names on the wire and restores the original skill ids on returned tool calls, which keeps MCP-backed tools usable even though Anthropic rejects characters such as `:` and `/` in tool names.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

For action-oriented workspace requests, AtlasMind also distinguishes between evidence-gathering and follow-through. Prompts that ask Atlas to wire, integrate, configure, support, add, update, fix, or otherwise implement behavior are now biased more aggressively toward direct execution, and after successful read-only evidence gathering AtlasMind issues one stronger follow-through reprompt before accepting a summary-only answer. Verification-style follow-ups such as asking whether a change actually happened now also trigger a repository-backed check, and investigation stalling like “I need to check” is treated as a retry signal rather than an acceptable final answer.

AtlasMind also treats prompts about the current project structure, settings pages, or voice and audio settings as workspace-backed investigation reque
…(truncated)

<!-- atlasmind-import
entry-path: architecture/model-routing.md
generator-version: 2
generated-at: 2026-04-18T13:16:49.354Z
source-paths: docs/model-routing.md
source-fingerprint: 1315288f
body-fingerprint: 587cb05e
-->
