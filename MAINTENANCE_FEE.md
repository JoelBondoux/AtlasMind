# Maintenance Fee

AtlasMind participates in the [Open Source Maintenance Fee](https://opensourcemaintenancefee.org)
(OSMF), and participates in it **optionally**.

**[Pay the maintenance fee → GitHub Sponsors](https://github.com/sponsors/JoelBondoux)**

---

## The short version

| | |
|---|---|
| **Who it's for** | Organisations with annual gross revenue of **USD 10,000 or more** using AtlasMind as part of revenue-generating work |
| **Amount** | **$10/mo** under 20 employees · **$40/mo** 20–100 · **$60/mo** over 100 |
| **Who it's not for** | Everyone else. Individuals, students, hobby projects, non-profits, open source projects, and anyone under that revenue threshold |
| **Is it required?** | **No.** See below — this is the one place AtlasMind departs from the published model |
| **What it buys you** | Nothing you don't already have. It funds the maintenance you already depend on |

---

## What the fee is

The idea behind OSMF is a distinction worth stating plainly: *the source code is free — as in
freedom — but the maintenance is not*. Keeping up with VS Code releases, eight model providers and
their APIs, security fixes, and the release hygiene nobody notices until it breaks is ongoing work,
and it is the part that no one-off contribution funds.

The fee is deliberately small and predictable. It is **not a support contract**, **not a licence
fee**, and buys no feature, no priority, and no different product. It is a way for an organisation
that depends on this project to fund the person maintaining it, at a number somebody else already
did the thinking about.

That last part is most of the value. "Sponsor if it helps you" puts the awkward question of *how
much* on the person least equipped to answer it, which is why it usually ends in nothing being
sent. A named tier is a line item somebody can approve.

## What the fee is not

**It is not a condition of using AtlasMind.** The published OSMF model makes the fee mandatory for
qualifying commercial users, enforced by an `OSMFEULA.txt` covering the *binary release* while the
source stays open. AtlasMind does not do that, and the departure is deliberate:

- **The licence is unmodified MIT.** [LICENSE](LICENSE) is the standard MIT text, with nothing
  added above or below it. Every right it grants is unconditional.
- **There is no EULA on the build.** The Marketplace `.vsix` carries no terms of its own. For a VS
  Code extension the "binary release" *is* how essentially everyone installs it, so a fee-bearing
  binary would not be a narrow carve-out — it would be the product, and MIT would be a technicality
  for the handful of people who clone and compile.
- **`package.json` still declares `"license": "MIT"`**, because that is still true. The OSMF setup
  guide asks JavaScript projects to change this to `SEE LICENSE IN OSMFEULA.txt`; AtlasMind does
  not, for the same reason.
- **Nothing is withheld from anyone who doesn't pay.** No access is suspended, no version is held
  back, no feature is gated. There is no enforcement here, and none is planned.

If you are a qualifying organisation, read the tiers as the amount you'd owe if it were mandatory
elsewhere — and then decide.

## The tiers

Taken from the OSMF's own recommended structure rather than invented here, so they are comparable
with every other project using the model:

| Organisation size | Fee |
|---|---|
| Under 20 employees | $10/month |
| 20–100 employees | $40/month |
| Over 100 employees | $60/month |

Paid through [GitHub Sponsors](https://github.com/sponsors/JoelBondoux). If a monthly line item is
harder for you to get approved than a single invoice, a one-off of twelve months is fine — say so
and it will be recorded as the year's fee.

## Recognition

Entirely your choice, and off by default. If you'd like your organisation listed, say so and it goes
in `CONTRIBUTORS.md` and the release notes. If you'd rather it stayed private, nothing is published.

## Related

- [Funding and sponsorship](wiki/Funding-and-Sponsorship.md) — sponsorship tiers for individuals and
  supporters, and what the money pays for
- [LICENSE](LICENSE) — the MIT licence, unmodified
- [opensourcemaintenancefee.org](https://opensourcemaintenancefee.org) — the model itself
