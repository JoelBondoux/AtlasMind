# Design note: an opt-in "Docker-capable" runner profile

**Status:** proposal only. Nothing in this note is implemented. The ephemeral, no-socket runner described in
[`local-ci-and-safe-runners.md`](local-ci-and-safe-runners.md) stays the default and the only profile
AtlasMind starts today.

## The problem

Some projects' test suites start their own containers: a throwaway PostgreSQL for integration tests, a
Redis, a mail catcher. AtlasMind's ephemeral runner cannot run those jobs, by design. Its container receives
no host mount and no Docker socket, so `docker run` inside a job fails. Those projects currently have two
choices: keep the job on GitHub-hosted runners (and stop when the monthly allowance runs out), or hand-build
a persistent runner with the socket mounted, as was done for one project on the maintainer's PC in
November 2026. This note records what that build taught, so a future AtlasMind profile can offer it with
the dangerous parts made explicit rather than rediscovered.

## The trade-off, stated plainly

Mounting `/var/run/docker.sock` into the runner gives every job **administrator control of the Docker
engine**. On Docker Desktop that engine is a VM with the host's drives shared into it, so a job can start a
container that mounts `C:\` (or `/Users`) and read or write anything there. On Linux the socket is
equivalent to root on the host. The official runner image also gives the `runner` user passwordless `sudo`.
No container flag narrows this: `--cap-drop ALL` and `no-new-privileges` apply to the runner container, not
to the sibling containers a job asks the engine to start.

So a Docker-capable runner is only acceptable when **every job that can reach it runs trusted code from the
same repository**:

- registered to one repository, with one dedicated label and `--no-default-labels`;
- reachable only from `push` and same-repository `pull_request` runs, never `pull_request_target`, never a
  fork's pull request, never a bot-started run (the existing `ATLASMIND_CI_RUNNER` switch line already
  sends those to GitHub-hosted runners);
- the repository's fork-workflow setting for private repositories turned off, and checked;
- no repository secret in any job routed to it.

Even then it is a step down from the default, and the profile must say so in its confirmation: *"Jobs on
this runner can control Docker on this computer, which is administrator access to it."* The no-socket
ephemeral runner remains the default, and the profile is a separate, explicitly named choice, never a
checkbox on the default.

## What a profile would have to do

These are the lessons from the hand-built runner, each of which cost a failed run to learn.

1. **Clean up between jobs with the runner's job hooks.** A persistent runner keeps its filesystem.
   `ACTIONS_RUNNER_HOOK_JOB_STARTED` should clear what earlier jobs left in `/tmp` (keeping the runner's own
   `.NET` pipes), because some actions refuse a stale download there.
   `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` should delete the finished job's checkout under `_work` (keeping the
   runner's `_actions`, `_tool` and `_temp`), because a checkout with `node_modules` and build output is
   several gigabytes and disks on shared machines fill up.
2. **Throwaway databases in memory.** Start test databases with `--tmpfs /var/lib/postgresql/data` (or the
   equivalent data path). A job that dies before its cleanup step then leaves no Docker volume behind; one
   runner without this left a volume per job.
3. **Guard hosted-only steps.** Steps that only make sense on a GitHub VM (restarting the system Docker
   service, `sudo apt-get` of packages the image already carries, Playwright's `--with-deps`) need
   `if: runner.environment == 'github-hosted'`, so the same workflow runs on both.
4. **`actions/setup-node` in every job.** The runner image has no Node.js on its `PATH`. A job that relied
   on the hosted image's preinstalled Node failed with `node: command not found` on the self-hosted runner.
   Every job that runs `node`, `npm` or `npx` sets Node up first, pinned by SHA.
5. **Playwright system packages from the lockfile's exact version.** If the image carries Chromium's system
   libraries, install them with Playwright's own `install-deps` from the exact `playwright-core` version
   and integrity hash that `package-lock.json` pins, and test that the two agree. Otherwise a Playwright
   upgrade silently needs libraries the image does not have.
6. **Do not dial `127.0.0.1` for a sibling container.** Docker Desktop forwards a port published on
   `127.0.0.1` to the Windows or macOS host, not into other containers. A job inside the runner that starts
   a database with `-p 127.0.0.1:5432:5432` and connects to `127.0.0.1:5432` reaches nothing. Dial the
   database container's own bridge address instead (`docker inspect -f
   '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <name>`), selected by an explicit setting so
   the same code still uses loopback on a hosted runner.
7. **Register with `--disableupdate` and pin the image by digest.** A persistent runner that updated itself
   inside its container (2.338.0 to 2.338.2) deleted its own `bin/Runner.Listener` and restart-looped. The
   default ephemeral runner now registers with `--disableupdate` too, and AtlasMind warns when the pinned
   digest falls behind GitHub's latest release; a profile inherits both.
8. **Take the machine-wide CI gate queue.** Heavy jobs on a shared machine take the same lock local gates
   use (`atlasmind.ci.gateQueue.lockPath`, or `ATLASMIND_CI_GATE_LOCK` inside the container with the lock's
   folder mounted), through `media/bin/atlasmind-ci-gate.mjs acquire` and `release` with `if: always()`.
   Light jobs that only read git can skip it. A self-hosted runner with no lock configured fails the heavy
   job rather than running beside another gate.
9. **Trust a TLS-inspection root by verification, not by switching verification off.** Install the
   operator's public root into the container's trust store at start, after checking it is a self-signed CA,
   in date and matches a pinned SHA-256 fingerprint (`atlasmind.ci.localRunner.additionalCaFile` and
   `additionalCaSha256`). Image builds receive it only as a BuildKit secret.

## What it would not do

- It would not mount the host's home directory, credential stores or SSH agent.
- It would not be offered for public repositories, for organisation-wide runner groups, or for any
  workflow the existing trusted-workflow review has not accepted.
- It would not start automatically; like the default runner, each start is a confirmed action.

## Open questions

- Whether to run the jobs' sibling containers through a rootless engine or a Docker-in-Docker sidecar with
  no host drives shared, which would narrow the blast radius at the cost of a second engine to manage.
- How to surface "this runner can control Docker" in the Pipeline view so it cannot be mistaken for the
  default profile.
