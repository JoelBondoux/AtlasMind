# Agents & Skills Summary

Tags: #import #architecture #agents #skills #mcp

## Agents
AtlasMind supports both persistent registered agents and ephemeral sub-agents synthesized for `/project` subtasks. Agent selection currently uses a lightweight relevance rank over enabled agents, with a built-in fallback when no specialist is a strong match.

## Skills
Built-in skills cover file operations, search, git, terminal execution, diagnostics, code navigation, memory access, checkpoints, tests, and diff inspection. AtlasMind also supports imported custom skills and MCP-sourced tools.

## Safety Model
- Empty agent skill lists imply access to all enabled skills.
- Skill enablement persists across sessions.
- Custom skills are security-scanned before enablement.
- Tool approval policy gates risky execution categories.

## MCP
MCP servers are first-class extension points. Connected server tools are registered into the SkillsRegistry as `mcp:<serverId>:<toolName>` skills and can participate in Atlas automation once connected.

## Product Consequence
AtlasMind is increasingly an automation platform, not just a chat shell. Future work should keep agent definitions, skill contracts, scans, and approval policies legible and reviewable.