# Security Policy Sync

Synchronized from `SECURITY.md` during SSOT import on 2026-04-16T17:23:22.316Z.

## Policy Content

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

Good-faith security research that avoids privacy violations, destructive actions, service disruption, or data exfiltration beyond minimal proof is welcomed.

Please avoid:
- Accessing data that 
…(truncated)

<!-- atlasmind-import
entry-path: misadventures/security-policy-sync.md
generator-version: 2
generated-at: 2026-04-16T17:23:22.316Z
source-paths: SECURITY.md
source-fingerprint: 413762e1
body-fingerprint: ced44d3e
-->
