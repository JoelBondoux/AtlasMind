# Security & Safety Summary

Tags: #import #operations #security #safety

## Core Safety Position
AtlasMind defaults to the safest reasonable behavior. Boundaries are treated as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.

## Key Controls
- SecretStorage for provider credentials.
- Memory scanning for prompt injection and credential leakage.
- Validation of webview messages before state mutation.
- Tool approval policies with support for read-only allowances and explicit approval on risky actions.
- Automatic checkpoints and rollback support for write-heavy automation.

## Engineering Consequence
Security-sensitive regressions are correctness bugs. Any future import, memory, or automation work should preserve path safety, redaction boundaries, validation, and explicit review points.