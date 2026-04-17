# AtlasMind Roadmap

## Extension Host & Walkthrough Suggestions (April 2026)

### Observed Issues & Warnings
- Unknown completionEvent `onChatParticipant:atlasmind.orchestrator` in walkthrough steps (package.json)
- Large extension state warning: consider using `storageUri` or `globalStorageUri` for large data
- Extension Host: ensure all custom events in walkthroughs are either implemented or removed to avoid VS Code warnings
- Review and optimize storage usage to prevent performance issues

### Action Items
- Remove or implement custom completionEvents in walkthrough steps
- Refactor storage of large data to use disk-based storage
- Audit walkthroughs for other non-standard events or triggers
- Monitor Extension Host logs for additional warnings or suggestions

---

## Next Steps
- [ ] Start work on completionEvents observation: audit, remove, or implement all custom events in walkthroughs
- [ ] Document and track all Extension Host suggestions and warnings
- [ ] Regularly review VS Code logs for new issues

---

*Last updated: April 17, 2026*
