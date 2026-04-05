# Development Workflow

Tags: #import #operations #workflow #release

## Local Loop
- Install with `npm install`.
- Build with `npm run compile` or `npm run watch`.
- Validate with `npm run lint`, `npm run test`, and `npm run test:coverage`.
- Package with `npm run package:vsix`.

## Branch Policy
- `develop` is the default integration branch and normal push target.
- `master` is release-ready and updated only through intentional promotion from `develop`.

## Release Hygiene
- Every change should carry the appropriate SemVer bump in `package.json`.
- Every version bump should have a matching `CHANGELOG.md` entry.
- Docs and wiki mirrors are expected to stay aligned with code changes.

## Import Relevance
AtlasMind should remember workflow and release policy because autonomous or semi-autonomous changes that ignore these rules create churn and review debt.