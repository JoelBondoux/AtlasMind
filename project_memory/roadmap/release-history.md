# Release History Snapshot

## [0.49.29] - 2026-04-18

### Added
- **Work-Timer MCP preset:** AtlasMind now includes a curated Work-Timer preset that prefills the documented local MCP launch path for the Work-Timer billing and time-tracking server.

## [0.49.28] - 2026-04-18

### Added
- **Editable configured MCP servers:** The Configured Servers page now lets operators reopen any saved MCP entry, adjust its command, arguments, environment JSON, URL, or enablement state, and save the update directly back through the Add Server form.

### Fixed
- **Transport-switch cleanup:** Editing a saved MCP server now clears stale stdio or HTTP-only fields when switching transport types so old parameters do not linger behind the new config.

## [0.49.27] - 2026-04-18

### Added
- **Expanded recommended MCP catalogue:** AtlasMind now includes curated starter entries for ecommerce, CMS, website-builder, video-platform, and social-media workflows, including Shopify, WooCommerce, WordPress, Webflow, Wix, YouTube, Twitch, LinkedIn, Meta Graph, and X.

## [0.49.26] - 2026-04-18

### Added
- **Cross-platform MCP runtime bootstrap:** The one-click recommended MCP installer now uses the appropriate local package manager on supported systems, including winget on Windows, Homebrew on macOS, and common Linux package managers such as apt-get, dnf, and pacman when those runtimes are available.

### Fixed
- **Fresh runtime discovery after bootstrap:** AtlasMind now searches common installation directories on Windows, macOS, and Linux so newly installed MCP launch commands can be detected without relying only on a stale shell PATH.

## [0.49.25] - 2026-04-18

### Added
- **Windows runtime bootstrap for curated MCP installs:** AtlasMind-ready MCP presets can now automatically install missing local runtimes through winget during the one-click install flow, including verified mappings for uv, Node.js LTS, GitKraken CLI, and .NET SDK 10 where those runtimes are required.

### Fixed
- **Clearer missing-runtime handling for stdio MCP servers:** When a recommended MCP preset fails because the local launcher is missing or exits immediately, AtlasMind now surfaces explicit runtime guidance instead of leaving operators with a generic connection-closed message.

## [0.49.24] - 2026-04-18

### Added
- **One-click CLI MCP setup:** AtlasMind-ready recommended MCP presets can now be installed and connected directly from the Settings dashboard without making operators re-enter the audited command details by hand.

### Fixed
- **Workspace token resolution for MCP launches:** CLI-backed presets that rely on values such as `${workspaceFolder}` or `${userHome}` now resolve those placeholders before AtlasMind starts the transport, which makes ready presets like Filesystem behave correctly on first connect.

## [0.49.23] - 2026-04-18

### Changed
- **Preset MCP connection audit completed:** Every recommended MCP server entry now has explicit audited setup guidance in the picker. 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-18T01:46:43.149Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: b3ad6f1a
body-fingerprint: 17134c86
-->
