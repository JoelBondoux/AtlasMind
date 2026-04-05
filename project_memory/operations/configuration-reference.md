# Configuration Reference Summary

Tags: #import #operations #configuration #settings

## High-Impact Settings
- `atlasmind.budgetMode` and `atlasmind.speedMode`: route model selection behavior.
- `atlasmind.ssotPath`: controls where the project memory lives.
- `atlasmind.toolApprovalMode` and `atlasmind.allowTerminalWrite`: shape risk boundaries around tool execution.
- `atlasmind.autoVerifyAfterWrite`, `atlasmind.autoVerifyScripts`, and `atlasmind.autoVerifyTimeoutMs`: control post-write verification.
- `/project` settings control approval thresholds, changed-file reference limits, and run report storage.

## Provider Configuration
- Azure OpenAI depends on endpoint plus deployment configuration and SecretStorage API key.
- Bedrock depends on region, model IDs, and AWS credentials.
- Local routing depends on a configurable OpenAI-compatible base URL.

## Operational Note
Configuration changes can alter routing, safety, execution policy, and what Atlas is allowed to do. Future automation should check these settings before assuming behavior.