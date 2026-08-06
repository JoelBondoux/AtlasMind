# Client review needs a rendezvous point. We are not going to host it.

**Decided:** 2026-08-06, shipped in v0.266.0.
**Status:** accepted.
**Supersedes:** the open question left in `project_memory/ideas/website-studio-strategy.md` §3.4 and §4.

## The problem

Client comment-on-element is the strongest differentiator available to Website Studio. It is the
point where the design surface, the engagement model and the delivery pipeline all meet, and no
competitor in the strategy document's §2 does all three.

It also needs something none of the rest of AtlasMind needs: **a place a client's browser can reach
that is not the developer's laptop.** AtlasMind is a local VS Code extension with a deny-by-default
posture and a stated principle of not running a hosted service. Those two facts are in direct
tension, and the strategy document deliberately left it unresolved rather than waving it through.

## What we considered

**A relay AtlasMind operates.** A small service that accepts comments and holds them until the
developer pulls. Rejected. It puts client work — unreleased marketing sites, sometimes under NDA — on
infrastructure we operate, which turns "AtlasMind is a local tool that never phones home" into a
sentence with an asterisk. It also means uptime, a privacy policy, a data-retention answer, a
security contact, and a bill. That is a different company, not a feature.

**A static export the client opens locally.** A single HTML file emailed back and forth. Rejected as
the *primary* path: it is not a link, it does not show the site as it will actually be, and
"open this attachment" is a worse ask than "click this URL".

**Reuse the staging environment we already build.** Accepted.

## What we built

The review overlay is **generated into the site itself**, so it travels wherever the site does —
including the password-protected staging environment the Stack page already sets up, on hosting the
client's project already pays for. AtlasMind writes files; the existing delivery pipeline puts them
somewhere; the client opens a normal URL and clicks the thing they want to talk about.

Comments come back one of two ways:

- **Export** (default). The client downloads a JSON file and sends it. `AtlasMind: Import Website
  Client Feedback` reads it. No network involved at any point.
- **Webhook** (opt-in, `atlasmind.website.review.webhookUrl`). If the team already owns an endpoint —
  a form handler, a Worker, an n8n webhook, which Website Studio already models — the overlay POSTs
  there. It is *their* endpoint, on *their* infrastructure, named explicitly. No URL is ever invented
  or defaulted, because a guessed endpoint would send a client's feedback to a stranger.

**AtlasMind hosts nothing and stores nothing on anyone's behalf.** The principle survives intact.

## What this cannot do

Stated plainly, because a decision record that only lists advantages is a sales page:

- **No live presence.** You cannot see the client commenting as they do it.
- **No threaded replies.** The client cannot see your response to their comment in the browser; that
  conversation happens wherever it happens today.
- **No cross-client visibility.** Two people reviewing the same staging site each hold their own
  comments in their own browser until they send them.
- **Comments live in `localStorage` until returned.** A client who clears their browser data before
  sending loses them. The overlay says so; it cannot do better without a server.
- **Export requires an action.** A client who comments and never clicks Download has told nobody. The
  webhook path fixes this for teams that have one.

## What would change the answer

- If a majority of real users turn out to have no staging environment at all, the "deploy it with the
  site" assumption fails and this needs revisiting.
- If threaded, live review turns out to be the thing agencies actually pay for — rather than
  *capturing feedback against the right element*, which is what we believe the real pain is — then a
  relay becomes worth its cost, and it should be a separate, opt-in product decision with its own
  privacy and retention answers, not a quiet expansion of this one.
- If a third party ships a review tool with a decent API, integrating is likely better than building.

## The security shape

Worth recording, because this is the only place AtlasMind puts JavaScript into a generated page:

- The overlay script is a **frozen constant** in `websiteReviewBundle.ts`. No model writes it, and
  nothing from the workspace is interpolated into it — its configuration travels in a `data-`
  attribute as JSON. A test asserts the emitted script is byte-identical to the constant.
- Review mode is off by default and is its own setting, separate from generation.
- The generated page's CSP names the single declared endpoint as the only permitted `connect-src`. In
  export-only mode `connect-src` is `'none'`: the page cannot make a request at all.
- Everything coming back is untrusted twice — third-party text, through a browser we do not control —
  and runs through the same sanitizer as the workspace file, then is fenced as REPORTED CONTENT
  before it ever reaches a model.
