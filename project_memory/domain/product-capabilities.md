# Product Capabilities

Imported from `README.md`.

## Configuration

AtlasMind's routing controls live under the `atlasmind.*` settings namespace. Alongside `budgetMode`, `speedMode`, and `feedbackRoutingWeight`, specialist routing can now be tuned per domain with `atlasmind.specialistRoutingOverrides` when a workspace needs to pin research, visual-analysis, voice, robotics, simulation, or media-generation requests to a preferred provider or fallback workflow surface. Local routing can also aggregate multiple labeled OpenAI-compatible endpoints through `atlasmind.localOpenAiEndpoints`, so one workspace can keep engines such as Ollama and LM Studio available together while AtlasMind still shows which endpoint owns each local model. The full settings reference lives in [docs/configuration.md](docs/configuration.md).

Detailed command and action reference lives in [wiki/Chat-Commands.md](wiki/Chat-Commands.md).

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-04-09T12:12:52.855Z
source-paths: README.md | package.json
source-fingerprint: 75b90624
body-fingerprint: 726678bf
-->
