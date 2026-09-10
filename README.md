<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.475.0</strong> · </sub></p>


<p align="center">
  <strong>BETA</strong><br />
  <strong>Your AI project manager, inside VS Code — with a delivery team attached.</strong><br />
  <em>Roadmap, risk, compliance and release, tracked from your own repository.<br />
  Bring the AI coding tool you already use, or use the team built in.</em>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind"><strong>Install from the VS Code Marketplace</strong></a>
  ·
  <a href="wiki/Getting-Started.md">Get started</a>
  ·
  <a href="wiki/FAQ.md">FAQ</a>
</p>

---

## What is AtlasMind?

**AtlasMind manages your project. It can also do the work.**

Most AI coding tools give you an assistant in a chat box. That solves *writing code*. It doesn't
tell you what to build next, what's blocking it, who owns it, what you deferred three weeks ago and
why, whether your tests actually cover what you claim, or whether you're fit to release.

That's the job AtlasMind does. A **25-page project dashboard** built entirely from your own
repository: roadmap and dependency graph, issues and pull requests, people and follow-ups, risk,
compliance, technical debt, defects, testing evidence, documents, delivery and release readiness. Nothing is
a form you fill in twice — it reads git, GitHub, your files and your project memory, then grades
what it finds against rules it **publishes on the card**, so you can see the reasoning and disagree
with it.

Attached to that is a team of **27 AI specialists** that can pick the work up and carry it out. Ask
in plain English; AtlasMind routes to the right specialist and a model that suits the task and your
budget, does the work, verifies it, and shows you what changed and what it cost.

**That second half is optional.** If you already have a favourite AI coding tool, keep it — see
below.

**You stay in charge throughout.** Nothing risky happens without your approval. Every automatic
step is one you switched on, and you can switch it off again.

---

## Who it's for

- **Solo developers and freelancers** carrying the project-management load themselves, on top of the code.
- **Small teams** who need a shared, reviewable way of working rather than everyone prompting differently.
- **Anyone already happy with their AI coding tool** who wants the management layer around it, not a replacement for it.
- **People learning professional practice** — the guided workflow explains *why* each step exists, not just what to click.

You do not need to be an AI expert. You do need a project you care about getting right.

---

## Use the AI coding tool you already have

**The management side doesn't need AtlasMind's chat.** Work the dashboard, keep the registers, run
the workflow — and let Copilot, Claude Code, Cursor, Codex, Gemini CLI or Windsurf write the code.

AtlasMind writes what it knows into the instruction files those tools already read —
`.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `GEMINI.md`,
`.windsurfrules` — as a **managed block** it maintains and you can delete: your enabled testing
methodologies, the technical-debt markers it scans for, and the stage-by-stage rules of your
declared GitHub workflow. Whatever agent you use gets told the same rules AtlasMind holds itself to,
and the registers keep working because they read your repository rather than your chat history.

Its own agents are there when you want them. They are not a prerequisite. Full setup in
[Bring Your Own AI Tool](wiki/Bring-Your-Own-AI-Tool.md).

---

## What you can actually do with it

**Run the project.** The dashboard is the point: what needs a person right now, what changed since
you last looked, what's blocking the roadmap, what you owe, and whether you can ship. Every number
links to the page that owns it, and every grade names the rule that produced it.

**Fix or build something.** Ask in chat like you'd ask a colleague. AtlasMind looks at your code,
picks a specialist, makes the change, verifies it, and reports back.

**Run a whole piece of work.** `/project Add Stripe checkout` produces a reviewable plan — the steps,
what depends on what, what it will touch, where it will pause for you — before anything happens.

**Chase a goal on its own.** `/loop` and Mission Control keep working towards an outcome inside limits
you set: how much it may spend, how long it may run, how many attempts it gets, and where it must stop
and ask.

**Think before you build.** The Ideation board lets you lay out problems, requirements, risks and
evidence, argue with yourself visually, and then turn the cards that survived into real roadmap items.

**Ship properly.** A guided eight-stage GitHub workflow takes you from an idea to a released version —
issues, branches, pull requests, review, CI, release — with a clear explanation at every step.

**Design an interface, then carry it into the project.** UI Studio works with websites, web and mobile
apps, desktop tools, editor extensions, embedded interfaces, and custom surfaces. It keeps screens,
flows, wireframes, content rules, real Markdown copy, UI-system decisions, and source-code handoff
guidance together. Its full preview opens in VS Code's built-in browser and combines the saved
wireframe, UI tokens, and exact Markdown copy; a separate responsive lab checks fixed device widths.
Website projects additionally retain the guarded sitemap, stack, hosting, and delivery workflow.
Select any block and describe it in plain English; every profile can generate a reviewable HTML visual
guide even when the eventual implementation is native rather than HTML.

---

## Get started in five minutes

1. [Install AtlasMind from the Marketplace](https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind).
2. Run **AtlasMind: Manage Model Providers** from the Command Palette (`Ctrl+Shift+P`) and connect one provider.
   Already pay for Claude, ChatGPT, Copilot or Qwen? You can use that subscription instead of an API key.
3. Open your project.
4. Tell AtlasMind about it — `@atlas /bootstrap` for a brand-new project, `@atlas /import` for an existing one.
5. Ask for something.

That's it. The [Getting Started guide](wiki/Getting-Started.md) covers the longer version.

**Only want the management layer?** Steps 3 and 4 are enough — run **AtlasMind: Open Project
Dashboard** and it reads your repository from there. A model provider is only needed for the parts
that ask a model to do something.

---

## Bring the models you already pay for

AtlasMind does not sell you tokens. Connect whatever you already have:

- **Cloud providers** — Anthropic, OpenAI, Google Gemini, Azure OpenAI, Amazon Bedrock, DeepSeek, Mistral, z.ai.
- **Subscriptions you already own** — a Claude, ChatGPT, Copilot or Qwen plan, or an eligible Gemini Code
  Assist licence, used as routable capacity with **no per-token cost**.
- **Local models** — Ollama, LM Studio, or anything else that speaks the OpenAI API. No key, no bill.

AtlasMind then chooses between them per task, based on what the task needs, what's healthy, what's fast
enough, what it costs, and what has actually worked well for you before. Set a daily spending cap and it
will respect it.

See [Model Routing](wiki/Model-Routing.md) for how the choice is made.

---

## Safety you can see

Ambitious automation is only worth having if you can trust it. AtlasMind is built so you can check it:

- **Nothing risky happens silently.** Writes, external calls, and destructive actions ask first — and you
  choose how often it asks.
- **Your keys stay in the OS keychain.** Never in settings files, never in your repository. Credentials
  found in what a tool read — a `.env`, a config file, a CI log — are pattern-matched and replaced
  before the result reaches a model. Pattern matching catches known shapes, not novel ones; the
  [Data privacy guide](wiki/Data-Privacy-and-GDPR.md) covers classifying what those patterns cannot see.
- **Model-written code does not run unless you say so.** When the model calls a tool that does not exist,
  AtlasMind can write one — but `atlasmind.skillAutoSynthesisEnabled` is off by default, and with it on
  every generated skill is scanned and shown to you before it executes.
- **Work gets verified.** Configured checks run after changes, and a run cannot report success while its
  own verification failed.
- **Production is protected.** Promoting to production is deny-by-default until the backups and approvals
  you required are actually there.
- **Everything untrusted is treated as untrusted** — issue text, web pages, model output, files. None of it
  can quietly become an instruction.

Full detail in the [Security model](wiki/Security.md) and [Tool Execution](wiki/Tool-Execution.md).

Personal and classified project context has a separate, opt-in boundary. The
[Data privacy and GDPR guide](wiki/Data-Privacy-and-GDPR.md) explains the detector pack, trusted-model
allow-list, redaction and file-withholding behaviour, retained metadata, provider references, and the
important limits on overrides and compliance claims.

---

## What's new in 0.475.0

The current source adds the change below on top of the last Marketplace publication, **v0.474.1**.
Every release is written up in full in [CHANGELOG.md](CHANGELOG.md).

- **Run a reviewed agent PR locally without trusting the agent by name.** AtlasMind can patch any
  GitHub repository with a committed exact-SHA local-CI contract, then let you inspect and approve one
  same-repository PR commit before lending a one-job Docker runner. Conventional npm, pnpm
  and Yarn repositories get a proposed locked install and check plan; another stack gets a disabled
  contract until you declare its argv commands. Codex, Claude, other agentic services, AtlasMind and
  human contributors all follow the same route. The controls live on Pipeline, Pull Requests and
  Settings → Testing, with `/localci patch` and `/localci review` shortcuts. A new commit invalidates
  the approval; forks, drafts, repository/environment secrets, host mounts, the Docker socket and
  native-platform claims are refused. The job retains outbound network access for GitHub and dependency
  installation, so Docker is defence in depth rather than a substitute for reviewing the proposed code.

- **Website delivery is on the Dashboard's Delivery page.** The framework choice, the three hosting
  environments, the platform targets and the n8n workflow map moved out of UI Studio and onto the
  Project Dashboard's Delivery page, beside the pipeline that ships them. Frameworks are graded
  against the primary platform with the reason on the card, each environment shows its readiness, the
  drift against the pipeline is checked on every render, and the setup button stays withheld until
  the setting is on. The Studio's Handoff view points there, and a save from either surface now
  re-reads the plan from disk and touches only what it owns, so neither can undo the other.

- **Emit a surface into its engine, and keep the words editable from here.** From the Handoff
  view, a drawn surface can be written for Web (HTML + CSS), Unity UI Toolkit (UXML + USS) or Godot 4
  (Control scene + Theme), with a shared token file from the brand presets; Unreal UMG, SwiftUI and
  Compose get a handoff specification rather than unverified source. The layout is emitted once and
  then belongs to the engine — a second emit over changed files is refused, and the card says
  *Layout: owned by Unity since the emit on … · Content: editable here*. The words stay Studio's:
  every node's copy sits in a region anchored by its id, and **Push content** patches those regions
  by anchor in the file as it is now, refusing by name any anchor the engine removed and showing
  any region somebody edited there rather than overwriting it. **Launch** runs Godot with a constant
  argv and no shell, opens a web page in the browser, and shows Unity's command to copy.

- **UI Studio, rebuilt around the surfaces.** The eight numbered steps and the six metric tiles are
  gone. A Surfaces rail beside the canvas lists every UI file the scan found in the project — pick one
  up and it becomes a surface that remembers where it came from — and every surface designed here;
  clicking one opens it on the canvas. The views across the top are unnumbered (Design, Sitemap or
  Screens & flows, Brands & system, Content design, Handoff, Delivery for websites, Brief) and the
  Studio lands on the canvas. A new **Brands** view shows each brand's swatches and origin, applies
  one to any set of surfaces, and reads a new one out of a stylesheet behind a confirmation that
  shows the extraction's own evidence. The browser only ever names a file or an id; the host re-scans
  and decides.

- **Brand presets.** One named set of colours, fonts, spacing and radius, applied to many surfaces
  **by alias** — change the brand and every surface follows, and a surface that keeps its own value is
  reported as an override rather than pretending to wear the brand. A preset can be read out of a
  stylesheet's custom properties, naming the file and line for every role and listing what it could
  not read instead of guessing. The old two-places-for-one-colour design system folds into a preset at
  migration, and only if you had changed it. The model half of the UI Studio rebuild; the surface
  above is the shell half.

- **The Ideation page, rebuilt as two panes.** The inspector used to sit under a canvas that filled
  the screen, so editing a card meant scrolling away from the board — and four "stages" explained an
  order the page did not have. Now a rail beside the canvas follows what you click: a card shows its
  inspector, a link its editor, nothing shows the prompt. The toolbar only draws; there is one way off
  the board, with the readiness reading inside it; and everything Atlas says lives in one drawer that
  opens itself when it speaks. The stat tiles, board lanes, stage bar and the 180-word shortcut
  paragraph are gone.

- **Tell AtlasMind what the project is for, and watch it stay honest about it.** A brief composer on
  the empty ideation board takes a couple of sentences in your own words and reads them into cards.
  **Every card either quotes your brief word for word or is a question** — a quote that is not really
  in your brief is turned into a question rather than shown as a finding, and the count is stated, so
  an invented reading cannot look clean. Your brief is **stored exactly as you wrote it** and never
  edited, which is what makes every derived card checkable. A brief too thin to work from is refused
  with what to add. Writing it, reading it into cards and raising roadmap items stay three separate
  confirmations.

- **Name a baseline, and compare against it whenever you like.** *What moved* could only ever answer
  "since you last looked" — the one span nobody chose. Now you can capture a moment worth comparing
  against and ask the same question about it: since the release, since this branch started, since the
  audit. It is the **same comparison**, so two cards can never disagree about one fortnight. **The age
  is always shown**, because eleven changes over six weeks is not eleven changes today. Nothing is
  captured automatically, nothing expires, and the oldest is never evicted to make room — it is the
  only one that can speak about the whole project.

- **Import absence from the rota app your team already uses.** Deputy, When I Work, Google Calendar or
  anything else that exports an `.ics` file. It reads the published iCalendar format rather than a
  vendor API, so one thing works everywhere. **Only events naming an absence are imported** — a rota
  feed is mostly the shifts somebody is *working*, and recording those as time off would mark them away
  on exactly the days they are rostered on; a file of shifts is refused, with that reason. Everything
  left alone is counted and shown. **Nothing is fetched**: a calendar feed URL is a password, so you
  download the file. The confirmation lists every entry, absence you typed by hand is kept, and
  re-importing updates in place.

- **See what each person is actually carrying — and read it honestly.** A Workload card on the
  Director page joins your roster to the roadmap's estimates and assignments. It is **not a
  performance measure**, and says so above the numbers: it counts work somebody was *given* against
  capacity they *declared*. Capacity is written down, never worked out from commit rates. An
  allocation it cannot read stays **unknown rather than being read as a full week**, unestimated work
  is never counted as zero, a derived estimate is counted but flagged as derived, and an empty rota
  means *nothing was recorded* rather than *everybody is available*. Overload is reported over a
  stated window and **nothing offers to reassign anybody**.

- **Golden cases for your agents, and a gate on the rewrite that would break them.** AtlasMind can
  rewrite an agent's prompt on a cadence — a prompt edit deployed with no failing build. Pin cases with
  a prompt, a check and the reason each exists, and a rewrite that regresses one is **held** rather than
  shipped. So is one that could not be checked, because the cadence runs while nobody is watching. An
  errored case is set aside rather than counted as a failure, a first run is a baseline rather than a
  pass, and every verdict says how many cases actually ran.
- **One button builds and publishes the portal.** Gather, narrow, prepare, deploy — with a single
  confirmation that says what goes out, what is withheld, who can read it, which commands will run and
  which step cannot be undone. It **refuses** rather than warns when you have named an audience your
  host cannot enforce, or when a risk register would go out behind a policy nobody has confirmed. On a
  host AtlasMind has no command for, it stops with the page prepared and leaves publishing to you.
- **Say where the portal is hosted, and who may read it.** A new host choice — GitHub Pages,
  Cloudflare Pages, Netlify, Vercel or your own — each presented with what it can *actually* enforce.
  **Signing in with GitHub admits every GitHub account there is**, so a sign-in without an allowlist is
  a public portal with a turnstile in front of it. Only Cloudflare Pages does both without an
  enterprise plan; Netlify's shared password is not an audience; Vercel's is your Vercel team; GitHub
  Pages cannot restrict at all outside Enterprise Cloud. The Director assigns the audience by contact,
  never by address, and AtlasMind never claims to be enforcing any of it.
- **Search your own codebase, semantically, without anything leaving the machine.** Two new commands
  build and search an index of your source — the gap that meant an agent had to be told which files to
  read. The default embedder needs no model at all; point it at a local Ollama model for genuinely
  semantic results. There is **no remote embedder**, because offering one from a dropdown would mean
  sending an entire repository to a third party. A file that looks like it holds a credential is never
  indexed, a result whose file has changed since is dropped rather than flagged, and every search says
  how much of the tree it actually covers and how old the index is.
- **The six utilities every product needs, as decisions rather than packages.** Auth, payments,
  email, analytics, i18n and accessibility now appear on the Gap Analysis page — each opening with the
  question that actually matters. Whether you or your vendor is the **merchant of record** is a tax
  question you cannot undo by swapping an SDK; whether your analytics sets a cookie decides whether you
  need a consent banner at all. Every install line is read from the vendor’s own documentation on a
  stated date and **nothing is ever run**; where a line was not verified, none is shown rather than one
  being invented. What leaves your machine is stated for every candidate. Two libraries answering
  opposite sides of one decision is reported, not added to. And accessibility is not offered as
  something to install, because it is not.
- **Ambient triggers: repository events, not just chat.** A failed CI run, an advisory, a review
  waiting on you, a blocker defect — all of them happen while you are looking somewhere else, and none
  of them reached you until you next opened the dashboard. Now they can raise a trigger. Off by
  default, and switching it on subscribes to nothing: each event is a separate decision. An event is a
  *change*, not a state, so a red pipeline fires once rather than on every check; an ambient response
  never goes further than **proposing**, whatever your workflow permits, because nobody is watching;
  and a source that could not be read is reported as *not observed* rather than as quiet. Nothing runs
  unattended — you get a notification and a draft.
- **Test management, for the half a scanner cannot read.** The Testing page now keeps the cases a
  person carries out: who owns each, when it was last actually run, and what a tester needs in front of
  them. Priority is derived from what breaks and how often the path is taken rather than asked for. A
  case that was not run is **never run**, not passed; a result belongs to a *revision*, so a pass
  against steps somebody has since rewritten reads as stale instead of staying green; and an automated
  case is never given a manual result, because its result is measured by the test report. Test assets
  **name** where a credential lives and never hold one — anything credential-shaped is refused outright
  rather than quietly stripped.
- **Who agreed, and to which version.** A new Approvals page records that a named person agreed to a
  change — an idea reaching the roadmap, a document going out, a licence term, a commercial
  commitment. Pending is never read as approved, there is deliberately no timeout that grants one,
  and an approval that was given before the content changed goes **stale** rather than carrying over.
  Each category routes to a role by a published rule, and if nobody holds it the request says so
  instead of being handed to whoever is available. It is a record, not a permission: nothing here
  blocks a commit or a release.
- **Somewhere to write a bug down.** A new Defects page keeps bugs in a local committed file, so
  recording one costs a keystroke rather than a remote, a `gh` and a network. Severity is never asked
  for — you say what it does and how many people meet it, and a published rule table grades it, so a
  grade made today still compares with one made in six months. Data loss and security exposures are
  blockers whatever their reach; an intermittent bug is not a smaller one; and *fixed* is kept apart
  from *verified*, because a fix nobody checked is a claim. Nothing is deleted and nothing is gated.
- **`/portal` hosts the producer report as an actual page.** The report could be built and narrowed;
  what was missing was the last mile, because GitHub Pages cannot serve an arbitrary folder. The guide
  walks it — including the fact that a Pages site is public even when the repository is private — and
  writes a deploy workflow that runs only when you run it. AtlasMind never turns Pages on and never
  publishes.
- **See what the chat is carrying, and carry less.** The context meter opens into a breakdown — session
  history, attachments, your draft, each with its share — and says what gets dropped first when the
  window fills. What the panel cannot measure (the system prompt, tool definitions, images) is named
  rather than quietly left out of the total, and one control lets you carry all, half, one or none of
  the earlier turns for this conversation.
- **Assess an advisory with Atlas.** Any Dependabot or code-scanning finding can be handed to an agent
  to answer the only question that matters: does it reach *your* code? "Present but not reachable here"
  is a first-class answer, the advisory's own text is fenced as third-party content, and a named fixed
  version is explicitly not treated as permission to bump it.
- **The Security page now says what is known to be wrong.** Dependabot alerts and code-scanning
  findings, ranked by severity across both, read when you refresh the repository. Severity is
  GitHub's rather than ours, a dismissal is counted as a decision and never as a fix, and if a source
  was not read — or the feature is switched off — the page says that instead of showing you a clean
  list.
- **A board view for the roadmap** — waiting, ready, in progress, in review, delivered. A card only
  moves on evidence AtlasMind can point at: a branch that exists, or an open pull request. Nothing is
  ever "in progress" because it looks important, delivered still means the backlog line is ticked, and
  if your branches or pull requests could not be read the board says that instead of showing a project
  where nobody has started.
- **The roadmap can now be read against time.** A fifth view puts the plan on a timeline: when each
  item can start and finish, how much room it has before the finish moves, and where each release gate
  lands. The axis is days from today rather than dates, deliberately — your estimates are graded in
  working days for people and wall clock for agents, and inventing a calendar to reconcile them would
  be a commitment made up by a chart. Deadlines you set are drawn as markers, and they never move a bar.
- **Ctrl+wheel zooms the Project Dashboard.** The gesture you already use in a browser now works on
  the densest page in AtlasMind, on Chromium's own zoom ladder, with a quiet indicator that appears
  only while zoomed and clicks back to 100%. The roadmap canvas keeps Ctrl+wheel for zooming the plan
  — whichever the pointer is over wins — and dragging a node still lands where you dropped it at any
  page zoom.
- **Security housekeeping, with the findings read rather than waved through.** Every open CodeQL alert
  on `develop` is addressed: 40 fixed, 8 dismissed with a written reason. The ones worth knowing about
  — webview image previews now only load a source AtlasMind recognises, the content-security-policy
  nonce comes from the platform CSPRNG instead of `Math.random()`, four webview values that were
  missing their HTML escape have it, and an "official" badge on a recommended MCP server is decided by
  parsing the URL's host rather than by looking for the host's name anywhere in it.
- **Dependencies are current.** Every open Dependabot update is in, including Vitest 5 — taken in one
  verified pass rather than merged one PR at a time. `@types/vscode` is deliberately held at the
  version `engines.vscode` declares, because raising it would raise the minimum VS Code you need.
- **The roadmap canvas stops glowing at an edge once you have dragged the plan back into view.** The
  strips that say "the plan continues that way" were only recomputed by the wheel, so panning with a
  drag — the way you move sideways — left them lit over cards that were already on screen.
- **AtlasMind notices what you keep reaching for.** If your runs shell out to `gh` again and again,
  the Runtime page will say once that there's a catalogued MCP server for it — and tell you what it
  *costs* in the same breath as what it adds, because an MCP server publishes its whole tool list
  into a budget your turns already spend. Say "Not this one" and it never comes back for that
  project. Nothing is installed, and setting one up leaves it switched off.
- **Commits can say which planned work they were for.** A commit message tells you what changed, and
  never told you which backlog item or issue it belonged to — so anything joining code back to intent
  had to guess from wording. AtlasMind now writes that link as a proper git trailer, taken from the
  branch naming convention your workflow declares rather than from the commit's words, and the
  dashboard's commit list shows it.
- **The dashboard says when your providers are in trouble.** It already counted them — `4/9 providers
  healthy` sat in a stat card's subtitle, in the same grey as everything else, on the page whose job
  is to tell you what needs a person. No enabled model anywhere now leads the *Needs you* band, above
  a red pipeline: a failing test is something you can work on, and no routable model is not. The
  score also reflects how much of your configured team actually gets used — silently, until there's
  enough run history to mean anything.
- **Roadmap work assigned to an AI agent is estimated in minutes, not working days.** If your agents
  do the coding, an item can be planned and finished inside an afternoon — and the roadmap couldn't
  say so, because every estimate was in working days with a half-day floor. Worse, the arithmetic
  rounded to the nearest half-day, so a plan run entirely by agents reported *no work left at all*.
  Mark a contact as an AI agent on the Director page and their roadmap work is graded in wall-clock
  instead. The size of the job is judged the same way; what a unit of it costs is not.
- **The roadmap now says which chain of work the finish date rests on.** The backlog could tell you
  what mattered most and the dependency canvas could tell you what waited on what. Neither said
  *which chain actually decides when this lands* — so a plan could be correctly prioritised,
  correctly sequenced, and still have everyone working on the items that were never the constraint.
  The canvas now names the critical path and the days along it, and a lens highlights it while
  leaving everything else drawn and dimmed, because the items with slack are the comparison that
  makes the answer worth having.
- **Closing or hiding a chat no longer stops it.** Clicking another view in the sidebar threw the
  chat's window away mid-answer — VS Code disposes a hidden view's webview — and that killed the run.
  The sidebar now keeps its contents when hidden, and a chat that genuinely loses its window keeps
  going: your answer is written to the session as it arrives, so reopening the chat shows the
  finished result. A run that outlives its window is still spending money, so a status-bar item names
  what's running and lets you read or stop any of it — closing the window is no longer how you stop a
  run, so that is. Reopen the chat and it picks the run back up: the answer streams in, the stop
  button is back where you'd look for it, and asking something else starts a fresh conversation
  rather than mixing two answers into one.
- **Two steps of a job can no longer overwrite each other's edits.** When AtlasMind broke work into
  steps it ran up to five of them at once against one copy of your files, with nothing keeping two of
  them from editing the same file — and when that happened, one of the two changes simply wasn't
  there afterwards, with both steps reported as finished. Steps that write now run one at a time.
  That is slower, and it is the correct behaviour. Turn on `execution.worktreeIsolation` and the
  parallelism comes back: each writing step gets its own git worktree, and its changes are applied to
  your files as its batch finishes. A step whose changes won't apply cleanly keeps its worktree and
  tells you where it is, rather than being forced in or thrown away. The second time a run queues
  writers behind each other, AtlasMind offers you the setting — once, never modally, and never when
  turning it on wouldn't have changed the run you just watched.
- **Select several items and move them together, on both canvases.** Shift-drag on the roadmap or
  the ideation board draws a selection box; dragging any selected item moves the whole group. Plain
  dragging still pans, because panning is how you read a plan that doesn't fit on screen. On the
  ideation board the box shares the selection that links cards, so selecting more than two now asks
  you to choose the pair rather than guessing at it.
- **"Read-only" now holds for the whole job, not just the first step.** Asking AtlasMind to work
  read-only was enforced properly on the turn you typed — but if that turn became a multi-step project
  run, each step re-read its own instructions and found no restriction in them. The limit you set now
  travels with the work and can only narrow, never widen. Separately, an MCP server that asked for one
  environment variable used to receive every credential the editor was started with; it now gets a
  filtered set plus what it declared.
- **Supply chain tightened.** Every CI action is now pinned to an exact commit rather than a movable
  tag, the project bootstrapper no longer starts a shell for anything, and the Debian install path
  that piped a download into `sudo` has been removed in favour of the manual instructions. There is a
  written [dependency review](docs/dependency-security-review.md) and an SBOM command.
- **Starting the editor contacts nobody.** AtlasMind loads when VS Code starts, and two things
  reached third parties from there that your settings never asked for: an exchange-rate lookup that
  ran even though costs display in USD by default and needed no conversion, and a downloadable-model
  catalogue fetched from two sites even on machines with no local model runtime installed. Both are
  now gated on your own configuration actually needing them. There is no telemetry and never has
  been.
- **Model-written skills no longer run beside the extension.** AtlasMind can write a small skill for
  itself mid-task — off by default, and never without you reading the code and approving it. Until now
  that code was evaluated in the extension's own scope: eight ways of reaching the filesystem were
  tried against it and seven worked. It now evaluates somewhere with none of that in reach, and all
  eight are refused. It is containment rather than a sandbox, the remaining gap is written down, and a
  test asserts we never call it the stronger word.
- **Routines show you the commands before they run, and Autopilot has a ceiling.** `/ship` and the
  Run Center now list the exact shell commands a routine will run, in order, and say which ones reach
  outside your machine — a routine file is an ordinary workspace file, so the moment before it runs is
  the moment worth reading it. A placeholder with no value is refused rather than quietly becoming an
  empty string. And Autopilot can no longer approve an outward change that cannot be undone — a push,
  a remote branch delete, or a tool AtlasMind does not recognise.
- **Nothing reaches a model without saying what it is.** Every prompt-bearing call in AtlasMind now
  clears its context through one boundary first, which redacts repository-derived text, holds each
  kind of content to its own size limit, and never silently rewrites what you typed. Direct calls
  that skipped it: 11 → 0, with an architectural test that fails when a new one appears. If a
  credential turns up in your own prompt on its way to an external provider, AtlasMind asks — *send
  redacted* or *send as typed* — and dismissing the dialog sends nothing.
- **AtlasMind follows the Open Source Maintenance Fee model.** The source code stays MIT permanently,
  and compiling it yourself is free for everyone, always. From **v1.0.0** the official Marketplace
  build carries a maintenance fee for organizations with annual gross revenue of US$10,000 or more
  that use it in revenue-generating work — $10–$60 a month by headcount. Nothing is payable before
  v1.0.0, nobody outside that scope ever pays, and no amount of money buys a feature, a vote or
  priority. See [MAINTENANCE_FEE.md](MAINTENANCE_FEE.md).
- **A command injection on Windows, found and closed.** Starting a tool through a shell concatenated
  model-generated arguments into one unescaped command line, so `&` followed by anything ran as a
  command of its own while the approval dialog showed something harmless. Commands now resolve to a
  real executable and start without a shell; where that cannot be done, the run is refused rather
  than falling back to the hazard.
- **The roadmap became a dependency canvas.** The prioritised backlog is unchanged and still the only
  place drag-reorder sets what comes next. Beside it, the plan now draws as a graph of what blocks
  what: a readable tree layout, search that frames what it matched, highlighting by release gate or
  owner, click-to-zoom, and edge hints when the plan continues past the frame. A roadmap AtlasMind
  did not write is reconciled instead of duplicated, and any item can file its own plan document.
- **An autonomous run refuses work your own workflow forbids, before spending anything.** The stage
  ceilings you declared are checked up front rather than discovered mid-run, so a run that was never
  permitted to open a pull request stops at the plan instead of at the attempt.
- **Delivery, people and interfaces.** The dashboard's version pills switch your checkout to the
  stage you clicked; the two people views in the sidebar stopped reporting the same number twice; and
  UI Studio can locate the interface in your repository rather than asking you to point at it.

---

## Recently shipped

Highlights from the last few releases. Everything here is already in the published build.

- **One request now finishes in one turn.** Ask AtlasMind to commit, push, promote or publish and it follows
  your project's declared route without stopping to ask you to repeat yourself. Approvals and release gates
  are unchanged.
- **Branches became a decision dashboard.** Every branch shows a plain verdict — *Ready for review*, *Needs
  attention*, *Blocked* — built from real pull request, review, CI and roadmap evidence. Compare any two
  branches, see who owns the changed code, and clean up merged branches through a guarded queue that never
  force-deletes.
- **Your subscription agents can do real work.** Claude Code, Codex and friends can now be given tool access
  for a task, with each operation logged. Off by default; one clearly-labelled switch turns it on.
- **Research scans that look outside your repository.** Seven questions — competition, customers, technology,
  feature gaps, market, funding, regulation — recorded as evidence your ideation board can use. Every finding
  carries a source, or it isn't recorded as a finding.
- **Testing stopped being a checkbox.** The methodologies you enable are now told to the agent writing the
  code, checked against what's actually in your repository, and counted in your project score — with an honest
  "nobody has looked yet" instead of a fake pass.

---

## What's included

| | |
|---|---|
| **A 25-page project dashboard** | Overview, project score, gap analysis, workflow, roadmap, issues, pull requests, approvals, people & follow-ups, branches, repository, pipeline, testing, tech debt, defects, security, privacy, risk, compliance, release, delivery, documents, project memory, runtime and ideation. Built from your repository, not from data you re-enter. |
| **Registers that don't forget** | Approvals, defects, test cases, tech debt, risk, compliance and research findings *transition* rather than vanish — resolved stays distinct from obsolete, accepted from dismissed — each graded by a published rule table so two people reading the same project get the same answer in March and in July. |
| **A roadmap that knows what blocks what** | A dependency graph beside the prioritised backlog: readable tree layout, release gates, owners, estimates, routes to any item, and honest "not assessed" instead of a confident zero. |
| **A team of specialists** | 27 built-in agents — debugger, frontend, backend, reviewer, security, testing, docs, performance, DevOps, dependencies, SEO, UX, release and CI, plus ethics, legal, commercial and market oversight. Add your own. Optional: bring your own AI tool instead. |
| **50 built-in skills** | File edits, the full local git lifecycle (branches, worktrees, fetch/pull, merge, stash), terminal, Docker, test runners, code navigation, debugging, web fetch, and more. Extend with your own or connect MCP servers. |
| **Smart model routing** | Cloud, local, or your existing subscription — chosen per task by fit, cost, speed, health, and past results. |
| **Project memory** | Architecture, decisions, roadmap, lessons and operations kept as readable Markdown in your repo, retrieved when relevant. |
| **A guided GitHub workflow** | Ideation → issues → branches → development → pull requests → CI → release → tech debt, each with its own automation level from *watch* to *act*. |
| **Reviewed-PR local CI** | Patch a repository once, inspect and approve one exact same-repository PR SHA, then run its declared checks on AtlasMind's one-job Docker runner. Codex, Claude, other agents and humans share the same boundary. |
| **Project planning & Mission Control** | Dependency-aware task plans, previews, checkpoints, resumable runs, and goal evaluation inside limits you set. |
| **Ideation board** | Visual thinking that reaches the backlog — cards become roadmap items, roadmap items become issue drafts. |
| **Tech debt register** | Deferred work found from your own code markers, graded by a published rule you can read, tracked rather than forgotten. |
| **Testing strategy** | 69 configurable methodologies — including data & schema, AI-specific and compliance families — with owners, tooling, evidence checks, scaffolding, and sync to other AI tools. |
| **Works with your existing AI tool** | Testing methodologies, debt markers and workflow rules synced into Copilot, Claude Code, Cursor, Codex, Gemini CLI and Windsurf instruction files as a managed block. The management layer needs no chat of its own. |
| **UI Studio** | Pick up the UI files already in the project or draw new surfaces, design them beside the canvas with a built-in-browser preview, brand them from named presets, and hand off to the implementation. Screens, flows, content, wireframes, tokens, components and responsive inspection are all here. Website delivery — the stack, the three hosting environments, the platform targets and the n8n map — lives on the Project Dashboard's Delivery page. |
| **Voice, vision & remote** | Local or hosted speech, image analysis, opt-in remote control, and a keep-awake lock for long runs. |
| **Lenses over your code — and your services** | Eleven read-only views built from what your project declares: flow, change impact, test evidence, state lifecycle, config precedence, field wiring, branch change story — plus three that compare your declared schemas against what a live API or database actually serves. Shape only: never a row, never a write, off by default. |
| **Honest cost tracking** | Per-session and per-model spend in your own currency, with model comparison and routing evidence. |

---

## Make it work the way you do

The **Personality Profile** shapes Atlas's role, tone, reasoning style, memory habits and boundaries. Save a
global baseline, then override it per project when a repository needs something different.

**Settings → Agents** shows the guardrails that apply to every agent, and opens the Agent Manager where you can
review the built-in agents or create your own with their own instructions, tools, models, budget and testing role.

More in [Agents](wiki/Agents.md) and [Skills](wiki/Skills.md).

---

## Chat commands

Type these in the AtlasMind chat panel as `/<command>`, or in the VS Code chat view as `@atlas /<command>`.

| Command | What it does |
|---|---|
| `/bootstrap` | Set up project memory and foundations; declare Shopify composition or choose a game architecture seed |
| `/import` | Build project memory from an existing repository |
| `/project <goal>` | Plan and run a coordinated piece of multi-step work |
| `/loop <goal>` | Chase a goal inside cost, time and iteration limits |
| `/ideate` | See what's on the ideation board and what needs attention |
| `/research` | What the research scans found outside your repository |
| `/agents` · `/skills` | List your agents and skills (edit them in the Agent Manager) |
| `/discover <query>` | Find MCP servers, agents, skills and APIs to add |
| `/memory <query>` | Query project memory (browse and edit it in the Memory view) |
| `/cost` | Running spend for this workspace across all sessions (each reply's own cost is in its footer) |
| `/runs` | Recent autonomous runs and checkpoints |
| `/director` · `/followups` | People, responsibilities, assignments and what's overdue |
| `/setup` · `/acp` · `/buzz` · `/lens` · `/localci` · `/portal` | Guided setup walkthroughs |
| `/localci patch` · `/localci-patch` | Preview and write the three AtlasMind-managed files that opt the current repository into reviewed-PR local CI |
| `/localci review` · `/localci-review` | Select an eligible PR, inspect and approve its exact head SHA, then start the one-job runner |
| `/compliance` | What evidences each governance regime, control by control; `/compliance next` for the next control needing a decision |
| `/ship [routine]` | Run a saved project routine |
| `/sync-instructions` | Keep every AI tool's instruction file in agreement |
| `/voice` · `/vision` | Speech and image analysis panels |

The same reviewed-PR operations are also available as **AtlasMind: Patch This Repository for Local CI** and **AtlasMind: Run a Reviewed Pull Request on Local CI** in the Command Palette.

Full behaviour and the Command Palette list are in [Chat Commands](wiki/Chat-Commands.md).

---

## A few settings worth knowing

Everything is in the AtlasMind Settings panel, or under `atlasmind.*` in VS Code settings.

| Setting | Default | What it does |
|---|---:|---|
| `budgetMode` | `balanced` | How much you're willing to spend per task |
| `speedMode` | `balanced` | Fast answers versus more considered ones |
| `dailyCostLimitUsd` | `0` | Daily spending cap; `0` means no cap |
| `memory.backgroundSummarizationMode` | `off` | Whether a background timer may summarise project memory with a model. Off by default — nothing is sent on a timer unless you enable it |
| `memory.selfHealingMode` | `report-only` | What background memory maintenance may do to your files. The default reports and never writes |
| `cost.comparisonModel` | *(empty)* | Re-price your spend against this model to see what the same work would have cost. Empty by default — the choice decides what the saving is measured against |
| `cost.historyLocation` | `machine-private` | Where this project's spend history lives. `repository` makes it diffable and report-readable; changing it moves what's already there |
| `producerReport.publishEnabled` | `false` | Allow the producer report to be prepared for GitHub Pages. A Pages site is public **even from a private repository** |
| `producerReport.publishRisks` · `publishCost` | `false` | Add the risk register or cost to the published page. Off separately, because each is a disclosure |
| `toolApprovalMode` | `ask-on-write` | How often AtlasMind asks before acting |
| `allowTerminalWrite` | `false` | Whether approved terminal commands may change things |
| `skillAutoSynthesisEnabled` | `false` | Let a model write a new skill and run it when a tool does not exist. Off; every synthesis is scanned and shown to you first |
| `cli.addToTerminalPath` | `false` | Put the `atlasmind` launchers on the PATH of new integrated terminals. Off, because it persistently changes your shell |
| `autoVerifyAfterWrite` | `true` | Run your checks automatically after a change |
| `ssotPath` | `project_memory` | Where project memory lives in your repo |
| `chatSessionTurnLimit` | `6` | How much recent conversation carries forward |
| `lens.live.enabled` | `false` | Let the live lenses read the schema a running service serves. Shape only, never a row |
| `ci.localRunner.enabled` | `false` | Permit one confirmed ephemeral runner for an already-queued trusted job; machine-scoped |
| `ci.localRunner.shutdownPolicy` | `ifStartedByAtlasMind` | Keep Docker open, close it only when AtlasMind opened it, or always close when no other container runs |
| `testing.resourceShare` | `50` | Sliding scale for local test execution: the percentage of this computer tests may use, across every path AtlasMind runs or composes; the OS always keeps ≥25% (≥2 CPUs / 8 GB); machine-scoped |
| `execution.worktreeIsolation` | `false` | Give each file-writing step of a job its own git worktree so a batch can write in parallel. Off means writers run one at a time — this setting buys back speed, it is not what makes the run safe |

All 154 settings are documented in the [Configuration reference](wiki/Configuration.md).

---

## Where things live

| Path | What's in it |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety, cost, project composition, opt-in workspace scope, read-only upstream distance, game-engine identity, bounded asset inventory, pure engine-fork interpretation, and hostile-input build-log reading (`projectComposition.ts`, `workspaceScope.ts`, `upstreamDivergence.ts`, `gameEngineIdentity.ts`, `gameAssetInventory.ts`, `gameEngineDivergence.ts`, `gameBuildLog.ts`), UI Studio's graph/edit/live-preview/repository core (`uiDesignGraph.ts`, `uiEditCommands.ts`, `uiPreviewRuntime.ts`, `uiRepositoryMapping.ts`, `uiRepositoryImport.ts`, `uiSurfaceScan.ts`), brand presets — one named token set applied to many surfaces by alias, extracted from a stylesheet with a citation (`brandPresets.ts`) — and the engine emitters with anchored, patch-by-anchor content write-back and constant-argv launch plans (`uiSurfaceEmit.ts`), CI inspection/scaffolding (`ciManager.ts`, `trustedLocalCiStarter.ts`), the CI route model, routing policy, build ledger and act adapter (`ciRoutes.ts`, `ciRoutingPolicy.ts`, `ciCreditMeter.ts`, `ciBuildLedger.ts`, `ciActRoute.ts`), the local CI guide, GitHub CLI installer and remembered machine inspection (`localCiSetupPlan.ts`, `localCiInstaller.ts`, `localCiInspectionMemory.ts`), the provider-neutral reviewed-PR contract, exact-SHA policy and repository patcher (`localCiRepositoryPatch.ts`, `reviewedPrLocalCi.ts`), confirmed-write echo (`trackerWriteOutcome.ts`), the register-to-work hand-off (`registerHandoff.ts`), the personal-vs-project split behind the two sidebar people views (`directorPriority.ts`), the semver primitives and branch-to-channel versioning policy (`semver.ts`, `versioningPolicy.ts`), the shell-free Windows shim bypass shared by the extension host, the CLI and the ACP launcher (`windowsShimBypass.ts`), parallel-write placement, worktree plumbing, merge-back and the run that ties them together (`worktreeIsolation.ts`, `worktreeManager.ts`, `worktreeMerge.ts`, `worktreeRun.ts`), the live security advisory feed and the per-turn context breakdown and the producer-portal hosting guide (`advisoryFeed.ts`, `contextBudget.ts`, `producerPortalPlan.ts`), the defect register — what is broken, graded by a published table rather than asked for (`defectRegister.ts`), the approval register — who agreed, to which version, and what goes stale when it changes (`changeApprovals.ts`), the test-case register — the manual half of testing, its owners and the assets it needs (`testCaseRegister.ts`), the ambient event bus — what may wake AtlasMind up, how far it may go, and why it stayed quiet (`ambientTriggers.ts`), the six cross-cutting utility decisions with their verified vendor facts (`utilityPacks.ts`), the searchable codebase index — what may be indexed, what is stale, and what a result may be taken to mean (`codebaseIndex.ts`, `codebaseIndexStore.ts`), where the producer portal is hosted and who may read it, and what one press to publish would actually do (`portalHosting.ts`, `portalPublishPlan.ts`), golden cases for an agent and the gate on an unattended prompt rewrite (`agentEvalHarness.ts`), what each person has been asked to do against the capacity they declared, and declared absence read out of an exported calendar (`teamWorkload.ts`, `rotaImport.ts`), baselines you can name so "what changed" can be asked about a moment you chose (`baselineRegister.ts`), the project in your own words and the grounding rule for anything read out of it (`projectBrief.ts`), the roadmap dependency graph, its overlay store, the chain the finish rests on and the plan against time (`roadmapGraph.ts`, `roadmapGraphStore.ts`, `roadmapCriticalPath.ts`, `roadmapTimeline.ts`, `roadmapBoard.ts`), whether the configured team can work and how much of it is used (`agentCapacity.ts`), and the git trailers that link a commit to the work it was for (`commitTrailers.ts`), and the evidence-triggered MCP capability offer (`capabilityOffer.ts`), release-gate destinations and urgency ordering (`releaseGateNavigation.ts`), roadmap ingestion from markdown, issues, Projects and spreadsheets (`roadmapImport.ts`, `roadmapReconcile.ts`) plus the guarded `localCiRunner.ts` executor, the governance-compliance stack — the control catalog, evidence register and readiness grader (`complianceControlCatalog.ts`, `complianceEvidenceRegister.ts`, `complianceReadiness.ts`) the per-methodology standard editions (`testingStandards.ts`), the Compliance page's view builder (`complianceDashboard.ts`), its walkthrough (`complianceSetupPlan.ts`), the shared stack-signal gatherer (`complianceStackSignals.ts`) and the mapping importer (`complianceMarkdownImport.ts`) — and project services |
| `src/runtime/` | Built-in agents and runtime composition |
| `src/providers/` | Model provider adapters, catalogs, health, `modelRole.ts` (what a model is *for*), and the local-GPU support layer — `gpuProbe.ts`, `localFootprint.ts`, `localRuntimeClient.ts` |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | Project memory: retrieval, scanning, redaction, persistence |
| `src/chat/` | The chat participant and interaction protocol |
| `src/views/` | Settings, dashboards, editors and sidebar surfaces, including the shared reviewed-PR local-CI action allowlist and host commands (`localCiSurfaceActions.ts`, `reviewedPrLocalCiCommands.ts`) |
| `src/acp/` and `src/cli/` | Subscription-agent sessions and the headless CLI |
| `src/mcp/` and `src/ard/` | MCP servers and agentic resource discovery |
| `src/voice/` and `src/remote/` | Voice backends and opt-in remote control |
| `.github/workflows/` | Hosted release CI plus the separately gated trusted local-runner workflow |
| `tests/` | Unit, integration, webview, security and regression coverage |
| `docs/` and `wiki/` | Developer reference, user guides, and the approved UI Studio and Chat reliability plans |

The full service map is in [Architecture](docs/architecture.md).

---

## Documentation

**Start here:** [Getting Started](wiki/Getting-Started.md) · [FAQ](wiki/FAQ.md) · [Chat Commands](wiki/Chat-Commands.md) · [Configuration](wiki/Configuration.md)

**Using it well:** [Agents](wiki/Agents.md) · [Skills](wiki/Skills.md) · [Model Routing](wiki/Model-Routing.md) · [Memory System](wiki/Memory-System.md) · [Project Planner](wiki/Project-Planner.md) · [Ideation](wiki/Ideation.md) · [GitHub Workflow](wiki/GitHub-Workflow.md) · [Delivery](wiki/Delivery.md) · [UI Studio](wiki/Website-Studio.md) · [UI Studio builder plan](wiki/UI-Studio-Builder-Plan.md) · [CLI](wiki/CLI.md)

**Trust and safety:** [Security](wiki/Security.md) · [Tool Execution](wiki/Tool-Execution.md)

**Under the hood:** [Architecture](docs/architecture.md) · [Development](docs/development.md) · [Chat reliability and capability broker plan](docs/chat-reliability-capability-broker-plan.md) · [Local CI and safe runners](docs/local-ci-and-safe-runners.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

---

## Open source, and the Maintenance Fee

**The source code is freely available under the [MIT licence](LICENSE)** — clone it, compile it,
modify it, redistribute it, no fee and no agreement. That does not change and is not going to.

This project participates in the [Open Source Maintenance Fee](https://opensourcemaintenancefee.org).
**From v1.0.0**, organizations with annual gross revenue of **US$10,000 or more** that use
AtlasMind's official releases as part of revenue-generating activities pay a monthly fee — **$10**
under 20 employees, **$40** to 100, **$60** above — through
[GitHub Sponsors](https://github.com/sponsors/JoelBondoux). The terms are
[OSMFEULA.txt](OSMFEULA.txt), and they cover the **official binary release**: the `.vsix` on the
Marketplace. Self-compiled builds are MIT and always will be.

**No fee is payable before v1.0.0.** AtlasMind is in Beta, and until then the MIT licence is the only
agreement that applies to any release. Nobody owes anything today. It's published now so it arrives
as a plan rather than a surprise, and 1.0.0 is the trigger because that's when the configuration and
memory formats freeze — a Beta that may still move under you hasn't earned it.

**Nobody outside that scope pays anything, ever.** Individuals, students, hobby projects,
non-profits, open source projects, and any organization under the revenue floor. There's a voluntary
$5 Supporter tier for them, and it is not the fee.

**No tier buys a feature, a vote, priority triage, a service level or a logo.** Every user gets the
same software. The fee funds maintenance — issue triage, releases, dependency and security updates —
not position in the queue.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Full detail in
[MAINTENANCE_FEE.md](MAINTENANCE_FEE.md) and
[Funding and sponsorship](wiki/Funding-and-Sponsorship.md).

