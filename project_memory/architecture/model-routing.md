# Model Routing Summary

Tags: #import #architecture #routing #providers

## Purpose
AtlasMind routes each request to the best available model instead of pinning the whole product to one provider.

## Routing Inputs
- Budget mode and speed mode from settings.
- Task profile inferred from the request phase, modality, reasoning level, and capability needs.
- Agent-level model restrictions.
- Provider health and enabled/disabled state.
- Capability and pricing metadata for candidate models.

## Current Provider Shape
Routed providers include OpenAI-compatible APIs, Anthropic, Google/Gemini, Azure OpenAI, Amazon Bedrock, local OpenAI-compatible endpoints, and VS Code Copilot. Specialist vendors such as EXA, ElevenLabs, Stability AI, and Runway are intentionally kept off the generic routed provider table.

## Important Routing Behaviors
- Cross-provider selection is the default unless an agent or request constrains it.
- Subscription and free models get cost advantages, but routing no longer lets zero cost overwhelm obvious capability gaps.
- Provider health is part of the routing decision.
- Discovery and refresh update live model catalogs while preserving operator enable/disable state.

## Implication For Future Work
Changes to provider metadata, discovery, or scoring affect both user trust and automation quality. Routing work should stay grounded in documented task-fit and safety tradeoffs, not just cost minimization.