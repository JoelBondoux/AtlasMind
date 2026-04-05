# Improvement Plan for Developer Experience

Tags: #developer-experience #build #lint #test

1. Add a --dry-run flag to the build command to allow users to preview changes without applying them. 2. Implement a --fix flag for the lint command to automatically fix common issues. 3. Add a --watch flag to the test command to enable continuous testing during development.

## VS Code Observability Roadmap Additions

1. Add explicit workspace observability so AtlasMind can proactively inspect Problems, test results, and recent terminal command output before answering or taking action.
2. Add dedicated debug-session integration so AtlasMind can inspect active sessions, stack traces, variables, and Debug Console context when troubleshooting.
3. Add safe readers for output channels and terminal sessions so AtlasMind can reason over what VS Code is already showing the user instead of relying only on newly executed commands.
