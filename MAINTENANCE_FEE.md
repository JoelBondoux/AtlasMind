# Maintenance Fee

AtlasMind follows the [Open Source Maintenance Fee](https://opensourcemaintenancefee.org) (OSMF)
model. The terms are in [OSMFEULA.txt](OSMFEULA.txt) — the OSMF EULA v1.1 template, unaltered, with
the Project's payment terms attached as a Schedule.

> ## Not during Beta.
>
> **No fee is payable before v1.0.0.** AtlasMind is in Beta, and until 1.0.0 the
> [MIT licence](LICENSE) is the only agreement that applies to any release. Nobody owes anything
> today. This page describes what applies **from v1.0.0**, published now so it arrives as a plan
> rather than a surprise.

---

## The short version

| | |
|---|---|
| **In force from** | **v1.0.0.** Not before |
| **Who pays** | Organizations with annual gross revenue of **US$10,000 or more** that use AtlasMind's official releases as part of revenue-generating activities |
| **Amount** | **$10/mo** under 20 employees · **$40/mo** 20–100 · **$60/mo** over 100 |
| **Who doesn't** | Everyone below that revenue, and anyone not using it in revenue-generating work — individuals, students, hobby projects, non-profits, open source projects. Also anyone already paying a separate support or maintenance agreement |
| **Required?** | **Yes**, for those it applies to. That is the model |
| **What it buys** | Nothing anyone else doesn't get. It funds maintenance |

**[Pay the Maintenance Fee → GitHub Sponsors](https://github.com/sponsors/JoelBondoux)**

---

## What is actually being licensed

This is the part worth reading carefully, because "open source project with a fee" sounds like a
contradiction and isn't one. There are two things here, and they are licensed differently:

**The source code is MIT, permanently.** [LICENSE](LICENSE) is the standard MIT text, unmodified,
with nothing added above or below it. Clone the repository, compile AtlasMind yourself, use it,
modify it, redistribute it — no fee, no agreement, no conditions beyond MIT's. Section 4 of the EULA
says this in its own words and says the MIT licence governs wherever the two disagree.

**The official binary release is covered by the EULA.** For AtlasMind that means the `.vsix`
published to the Visual Studio Marketplace. That is the artefact the fee attaches to, and for a VS
Code extension it is how essentially everyone installs it — so this is not a technicality, and it
would be dishonest to present it as one. If you qualify under Section 1 and install from the
Marketplace from v1.0.0 onwards, the fee applies to you.

**What this costs AtlasMind, stated plainly.** The extension is no longer *free for everyone in every
form*. `package.json` declares `SEE LICENSE IN OSMFEULA.txt` rather than `MIT`, because the package
it describes is the binary. The source remains open source by any definition, including the OSI's;
the published build is open source plus a maintenance obligation for organizations above a revenue
floor. Both halves of that sentence are true and neither should be dropped when quoting it.

## Why a fee at all

The distinction the model rests on is worth stating plainly: *the source code is free — as in
freedom — but the maintenance is not.* Keeping up with VS Code releases, eight model providers and
their APIs, security fixes, and the release hygiene nobody notices until it breaks is ongoing work,
and it is the part no one-off contribution funds.

The fee is deliberately small, predictable, and the same for everyone in a size band. It is **not a
support contract**, and buys no feature, no priority, no service level and no privilege. Every user
gets the same software. That is not a caveat — it is the point. A fee that bought you position in
the queue would be a paid tier, and this is not one.

The reason it is a *fee* rather than an appeal is that "support us if this helps you" puts the
question of *how much* on the person least equipped to answer it, which is usually why nothing gets
sent. A named amount is a line item somebody can approve.

## Why v1.0.0, and not a date

OSMF's guidance is to announce three to six months before enforcement. A version is the better
trigger for a project at this stage, for two reasons.

A date arrives whether or not the software is ready. A version arrives when it is, and it is a state
anybody can check rather than a promise they have to trust.

More importantly, 1.0.0 is already the release where AtlasMind's configuration and memory formats
freeze — the point at which this becomes something an organization can build on without being
migrated out from under. Charging for maintenance is reasonable from exactly that moment and not
really before it. A Beta that may still move under you has not earned it.

Section 2 of the EULA defers payment terms to the Project, which is where the commencement lives, so
this is inside the model rather than a departure from it.

## The tiers (from v1.0.0)

The OSMF's own recommended structure rather than anything invented here, so it is comparable with
every other project on the model. These are the GitHub Sponsors tier names — pick the one matching
your headcount:

| Sponsors tier | Organization size | Fee |
|---|---|---|
| **Maintenance Fee: Small Organizations** | Fewer than 20 employees | $10/month |
| **Maintenance Fee: Medium Organizations** | 20 to 100 employees | $40/month |
| **Maintenance Fee: Large Organizations** | More than 100 employees | $60/month |

If a monthly line item is harder to get approved than a single invoice, the **one-off** tier takes
any amount — send twelve months, say so, and it is recorded as the year's fee.

Nothing needs doing today. If your organization would rather get the approval out of the way early,
sponsor at whatever level suits and it will count.

## The $5 Supporter tier is not this

There is a separate **Supporter** tier at $5/month for individuals, students, and anyone using
AtlasMind outside commercial work. It is entirely voluntary, it is not the Maintenance Fee, and no
individual is within scope of the fee at any revenue or headcount.

The two asks are aimed at different people and collapsing them would get both wrong: an individual
reading a fee schedule concludes they owe something, and an organization reading a tip jar concludes
nothing is expected.

## Recognition

Entirely your choice, and off by default. If you'd like your organization listed, say so and it goes
in [CONTRIBUTORS.md](CONTRIBUTORS.md). If you'd rather it stayed private, nothing is published.

## Related

- [OSMFEULA.txt](OSMFEULA.txt) — the agreement itself
- [LICENSE](LICENSE) — the MIT licence covering the source, unmodified
- [Funding and sponsorship](wiki/Funding-and-Sponsorship.md) — the Supporter tier and what the money
  pays for
- [opensourcemaintenancefee.org](https://opensourcemaintenancefee.org) — the model
