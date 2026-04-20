# User Environment Tracking for AtlasMind

AtlasMind now detects and stores each user's development environment (OS, hardware, shell, editor) on activation. This information is stored privately per user and is never shared with other users or the workspace. AtlasMind uses this data to tailor commands and suggestions to your current environment.

- Data is stored in VS Code SecretStorage (never in project files).
- Multiple environments per user are supported (e.g., different machines/locations).
- No user can see another user's environment data.

See docs/development.md and wiki/Configuration.md for details.