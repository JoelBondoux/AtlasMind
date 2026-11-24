# Exploratory test charters

Session-based charters for the surfaces where automation has not caught up. Each charter names the
person, the mission, what is in and out of scope, and a time box. A session logs what was found
against the charter; a finding that needs fixing goes to the defect register, not here.

Maintained by hand. The testing matrix (`index/testing-config.json`) declares Exploratory as an
active methodology; this page is where its charters and session logs live.

## Charter: a novice gets one pull request mergeable from the Pipeline page

- **Mission.** Acting as a product director who has never run CI by hand, open AtlasMind on a
  repository patched for reviewed-PR local CI, and make one open pull request that is blocked on the
  `AtlasMind/local-ci` check mergeable, using only what the Pipeline and Pull Requests pages say.
  No documentation, no chat help.
- **In scope.** The Pull Requests row for the blocked PR; the Needs-you card; the reviewed-PR card's
  state and buttons; Runners & rules section 1; the approval modal; the queue-clearing dialog; the
  runner card's failure hint when the container dies; the final toast and commit status.
- **Out of scope.** Trusted-branch pushes; the routing grid; hosted CI; anything in Settings.
- **Time box.** 30 minutes.
- **Pass.** The PR shows the check green without the tester opening a document or asking a person.
  Every refusal names the folder, the file and the next step. Every yellow or red state has a button
  that leads to its fix.
- **Note on each stop.** Where the tester hesitated for more than ten seconds, what the screen said,
  and what they expected it to say.

### Session log

| Date | Tester | Result | Findings |
|---|---|---|---|
| 2026-11-23 | Product director, JoelBondouxNet PR #73 | Not completed in the box | Eight stops, all recorded in the Pipeline review of that date and fixed in 0.517.0 to 0.524.0: refusal named neither folder nor file; stale queued runs blocked every dispatch and could not be cleared; Rules opened on the trusted-branch checklist; "Patch repository" was primary on a patched repository; the PR row read green while a required check was unposted; the runner's TLS death showed a stack trace with no fix; chips and tiles unexplained. |

A rerun of this charter against 0.524.0 is due before the Pipeline page is next changed.
