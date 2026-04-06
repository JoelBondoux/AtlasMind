# Dependencies (node)

```json
{
  "name": "atlasmind",
  "displayName": "AtlasMind",
  "description": "Developer-centric multi-agent orchestrator for VS Code with model routing, long-term memory, and skills registry.",
  "version": "0.40.2",
  "publisher": "JoelBondoux",
  "license": "MIT",
  "funding": {
    "type": "GitHub Sponsors",
    "url": "https://github.com/sponsors/JoelBondoux"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/JoelBondoux/AtlasMind.git"
  },
  "bugs": {
    "url": "https://github.com/JoelBondoux/AtlasMind/issues"
  },
  "homepage": "https://github.com/JoelBondoux/AtlasMind#readme",
  "engines": {
    "vscode": "^1.95.0"
  },
  "categories": [
    "AI",
    "Chat",
    "Other"
  ],
  "keywords": [
    "ai",
    "agents",
    "orchestrator",
    "multi-agent",
    "llm",
    "copilot"
  ],
  "icon": "media/icon.png",
  "activationEvents": [
    "onStartupFinished",
    "onChatParticipant:atlasmind.orchestrator"
  ],
  "main": "./out/extension.js",
  "bin": {
    "atlasmind": "./out/cli/main.js"
  },
  "contributes": {
    "chatParticipants": [
      {
        "id": "atlasmind.orchestrator",
        "fullName": "AtlasMind",
        "name": "atlas",
        "description": "Multi-agent orchestrator with model routing & memory",
        "isSticky": true,
        "commands": [
          {
            "name": "bootstrap",
            "description": "Initialise a new project with SSOT memory structure"
          },
          {
            "name": "import",
            "description": "Import an existing project by scanning files and populating memory"
          },
          {
            "name": "agents",
            "description": "List or manage registered agents"
          },
          {
            "name": "skills",
            "description": "List or manage registered skills"
          },
          {
            "name": "memory",
            "description": "Query or manage the SSOT memory system"
          },
          {
            "name": "cost",
            "description": "Show cost summary for the current session"
          },
          {
            "name": "project",
            "description": "Decompose a goal into tests-first subtasks and execute autonomously"
          },
          {
            "name": "voice",
            "description": "Open the Voice Panel for text-to-speech and speech-to-text"
          },
          {
            "name": "visi
…(truncated)
```

<!-- atlasmind-import
entry-path: architecture/dependencies.md
generator-version: 2
generated-at: 2026-04-06T11:14:21.330Z
source-paths: package.json
source-fingerprint: d0eeadc3
body-fingerprint: b1431857
-->
