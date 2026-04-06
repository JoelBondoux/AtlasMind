# Improvement Plan for Developer Experience

Tags: #developer-experience #build #lint #test

1. Add a --dry-run flag to the build command to allow users to preview changes without applying them. 2. Implement a --fix flag for the lint command to automatically fix common issues. 3. Add a --watch flag to the test command to enable continuous testing during development.

## VS Code Observability Roadmap Additions

1. Add explicit workspace observability so AtlasMind can proactively inspect Problems, test results, and recent terminal command output before answering or taking action.
2. Add dedicated debug-session integration so AtlasMind can inspect active sessions, stack traces, variables, and Debug Console context when troubleshooting.
3. Add safe readers for output channels and terminal sessions so AtlasMind can reason over what VS Code is already showing the user instead of relying only on newly executed commands.
4. Add a curated interoperability layer for the 50 most commonly used developer-focused VS Code extensions so AtlasMind can discover each extension's commands, panels, tree views, and task-oriented surfaces without depending on one-off integrations.
5. Extend the observability and action model to cover extension-owned interface windows and panes, including Output channels, integrated terminals, extension webviews, test explorers, source-control panes, and other developer workflow surfaces that are already visible inside VS Code.
6. Add first-class Ports view support so AtlasMind can inspect forwarded ports, reason about local service availability, and help users open, label, manage, and troubleshoot port-forwarded development sessions from within VS Code.
7. Define safety and approval boundaries for extension interaction so AtlasMind can read passive state broadly, but requires explicit approval before invoking extension commands, mutating extension settings, or performing actions through sensitive workflow surfaces.

## Cost Management

1. Create a cost management dashboard with charts to identify costly workflows and models.
2. Add an interface icon to the chat response bubbles which has a cost for the message and cost for the session listed in the tooltip.

   
