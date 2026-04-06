# Security & Safety Summary

## Guardrail Principles
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, and deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

## Runtime Boundaries
## Security Boundaries

- Webviews are isolated behind a strict CSP and communicate only through validated message payloads.
- Provider credentials belong in VS Code SecretStorage and are not part of the SSOT or workspace configuration.
- Bootstrap operations are constrained to safe relative paths inside the current workspace.
- Future orchestrator execution should preserve the same rule: validate inputs, redact secrets, and prefer explicit user confirmation for risky actions.

## Quality Gates

- Local quality loop: `npm run lint`, `npm run test`, `npm run compile`.
- CI pipeline (`.github/workflows/ci.yml`) enforces compile, lint, test, and coverage for pushes and pull requests to `master`.
- Ownership and review enforcement are defined in `.github/CODEOWNERS`.

## Repository Security Policy
# Security Policy

## Supported Versions

AtlasMind uses a latest-supported release policy for security fixes.

| Version | Supported |
|---|---|
| 0.12.x | Yes |
| 0.11.x and below | No |

Security fixes are shipped on the latest patch or minor line only.

## Reporting a Vulnerability

Do not open public GitHub issues for suspected vulnerabilities.

Preferred disclosure path:
1. Use GitHub's private vulnerability reporting / security advisory flow for this repository.
2. Include a clear description of the issue, impact, affected files or features, and reproduction steps.
3. If credentials, tokens, or private data were exposed, say so explicitly.

Please include:
- Affected AtlasMind version
- Environment details (VS Code version, Node.js version, OS)
- Reproduction steps or proof-of-concept
- Expected behavior and actual behavior
- Any suggested remediation if available

## Response Goals

AtlasMind aims to:
- Acknowledge reports within 3 business days
- Reproduce and triage valid reports promptly
- Ship a fix or mitigation as quickly as practical based on severity
- Credit reporters if they want public acknowledgment after remediation

## Scope

In scope:
- Secret leakage or unsafe storage of credentials
- Webview message validation bypasses
- Path traversal or unsafe filesystem access
- Prompt-injection boundary bypasses in SSOT or tool execution
- Unsafe MCP, provider, or webhook behavior that crosses trust boundaries
- Dependency vulnerabilities affecting shipped or development workflows

Out of scope:
- Requests for support or general setup help
- Vulnerabilities only present in unsupported versions
- Issues requiring unrealistic local machine compromise without an AtlasMind-specific exploit path

## Safe Harbor
…(truncated)

<!-- atlasmind-import
entry-path: operations/security-and-safety.md
generator-version: 2
generated-at: 2026-04-06T19:43:49.858Z
source-paths: SECURITY.md | docs/architecture.md | .github/copilot-instructions.md
source-fingerprint: c5e4b3c4
body-fingerprint: 33b05c10
-->
