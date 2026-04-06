# Model Routing Summary

Source: `docs/model-routing.md`

## Overview

The Model Router selects the best LLM for each request based on user preferences, agent constraints, inferred task profile, model capabilities, and cost.

For OpenAI-family chat completion providers, AtlasMind now applies provider-specific compatibility rules instead of one shared payload shape. OpenAI and Azure OpenAI use the newer chat contract with `developer` messages and `max_completion_tokens`, while third-party OpenAI-compatible providers continue using the broader `system` plus `max_tokens` contract for compatibility. AtlasMind also omits `temperature` for fixed-temperature OpenAI model families such as GPT-5 and the `o`-series, while retaining it for models and providers that still support sampling controls.

AtlasMind can also perform one bounded escalation during execution when the current model shows repeated struggle signals, such as repeated failed tool calls or excessive tool-loop churn. In those cases it reroutes to a stronger reasoning-capable model instead of exhausting the entire loop on the weaker route.

If the selected provider fails outright, AtlasMind now attempts a bounded provider failover and reroutes the task to another eligible provider before surfacing a final error.

AtlasMind also includes workstation context in routed prompts so response formatting can default to the active environment, such as preferring PowerShell command examples on Windows inside VS Code unless the user asks for another shell or platform.

For responses viewed in the shared AtlasMind chat workspace, assistant bubbles now expose thumbs up and thumbs down controls. AtlasMind persists those votes per assistant turn, aggregates them by `modelUsed`, and folds them back into future routing as a small bounded preference bias rather than a hard provider or model lock.

## Routing Inputs

| Input | Source | Description |
|---|---|---|
| Budget mode | User setting (`atlasmind.budgetMode`) | `cheap`, `balanced`, `expensive`, `auto` |
| Speed mode | User setting (`atlasmind.speedMode`) | `fast`, `balanced`, `considered`, `auto` |
| Feedback routing weight | User setting (`atlasmind.feedbackRoutingWeight`) | Multiplier for thumbs-based routing bias; `0` disables it and `1` is the default slight influence |
| Max cost | Per-request or agent-level limit | Hard USD cap for the request |
| Preferred provider | Routing constraints | Soft preference for a specific provider |
| Allowed models | `AgentDefinition.allowedModels` | Whitelist — empty means any |
| Task profile | `TaskProfiler` | Inferred `phase`, `modality`, `reasoning`, and capability needs |
| Model capabilities | `ModelInfo.capabilities` | `chat`, `code`, `vision`, `function_calling`, `reasoning` |
| Provider availability | Health check result | Whether the provider is reachable |
| User feedback bias | Chat thumbs up/down history | Small per-model preference signal derived from stored assistant-response votes |

## Task Profiles

AtlasMind now profiles each request before routing. The
…(truncated)

<!-- atlasmind-import
entry-path: architecture/model-routing.md
generator-version: 2
generated-at: 2026-04-06T09:12:12.750Z
source-paths: docs/model-routing.md
source-fingerprint: 9390ddd3
body-fingerprint: 9c0f5229
-->
