# Project Routines

Place routine definition files in this folder. Each `.md` file (except this README) defines one named routine that AtlasMind can execute via `/ship` in chat or the **Run Routine** button in the Project Run Center.

## File Format

Each routine file uses YAML frontmatter between `---` fences:

```yaml
---
id: publish
name: Publish Release
description: Run tests, bump version, commit, push, and deploy
default: true
steps:
  - id: test
    label: Run tests
    run: npm run test:ci
    on_fail: abort
  - id: bump
    label: Bump version
    run: npm version patch --no-git-tag-version
    on_fail: abort
  - id: commit
    label: Commit changes
    run: git add -A && git commit -m "${message}"
    on_fail: abort
  - id: push
    label: Push to remote
    run: git push
    on_fail: abort
  - id: deploy
    label: Deploy
    run: npm run deploy
    on_fail: prompt
---

Optional markdown description below the frontmatter — shown in the UI but not used by the runner.
```

## Fields

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique identifier used in `/ship <id>` and the dropdown |
| `name` | Yes | Human-readable label shown in the dashboard |
| `description` | No | Short summary shown below the title |
| `default` | No | Set `true` on the routine that `/ship` (with no argument) should run |
| `steps` | Yes | Ordered list of steps to execute |

## Step Fields

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique step identifier within the routine |
| `label` | Yes | Human-readable step name shown in progress output |
| `run` | Yes | Shell command to execute. Supports `${message}` and `${version}` interpolation |
| `on_fail` | Yes | `abort` stops execution immediately; `prompt` asks the user; `continue` logs and moves on |

## Variable Interpolation

The `run` field supports `${varName}` tokens:

- `${message}` — commit message text (taken from the chat prompt after `/ship`)
- `${version}` — the `version` field from `package.json` if present

## Using `/ship`

```
/ship                   → runs the default routine
/ship publish           → runs the routine with id: publish
/ship publish fix: auth → runs publish, sets ${message} = "fix: auth"
```

## Example: AtlasMind commit-and-push routine

Save this as `commit-push.md`:

```yaml
---
id: commit-push
name: Commit & Push
description: Stage all changes, commit with a message, and push to origin/develop
default: false
steps:
  - id: stage
    label: Stage all changes
    run: git add -A
    on_fail: abort
  - id: commit
    label: Commit
    run: git commit -m "${message}"
    on_fail: abort
  - id: push
    label: Push to origin/develop
    run: git push origin develop
    on_fail: abort
---
```

Then run `/ship commit-push fix: repaired login bug` to stage, commit with that message, and push.
