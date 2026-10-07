# Google Search campaigns — draft (2026-10-06)

Replaces Meta: about $400 spent there with zero review requests, and it's paused. Google Ads account 273-452-9153 was reactivated 10/6; the old 2018 "Shotrox Webdesign" campaign is paused and ended.

Rules carried over from the site and the Brain: no prices, no knocking agencies, "remote, dedicated developer", most changes go live the same business day (never "always same day"), and the concrete5 end-of-support date is credited to Concrete CMS.

## Account setup (before any campaign)
1. **Auto-tagging ON:** Admin → Account settings → Auto-tagging. GA4 needs it to see ad clicks.
2. **Link GA4** (G-896FL0DLQD): Tools → Data manager → Google Analytics.
3. **Import the conversion:** Goals → Conversions → Import from GA4 → `generate_lead`. It fires only when the free-review form is submitted.
4. Time zone is Pacific and can't be changed. That's fine; just remember reports run 2 hours behind Central.

## Shared settings (both campaigns)
- Type: **Search only.** Untick Display Network and Search Partners.
- Location: United States, set to **"Presence: people in or regularly in"** (not "interest").
- Bidding for the first 2–3 weeks: **Maximize clicks with a max CPC cap of $6**. Switch to Maximize conversions after about 15 conversions.
- Turn off auto-apply recommendations and keep AI Max off.
- Keyword match types: **phrase and exact only.** No broad match.

### Account-level negative keywords
free, jobs, job, hiring, career, careers, salary, internship, course, courses, tutorial, training, certification, how to, download, template, templates, theme, themes, plugin, cheap, reddit, youtube, upwork, fiverr, freelancer jobs, remote jobs, india, philippines, pakistan

## Campaign 1 — "Search · concrete5 migration" — $10/day
**Why first:** few people search these terms, but they're very motivated and cheap, and few specialists are left.

Landing page: `https://schottky.com/?utm_source=google&utm_medium=cpc&utm_campaign=concrete5#concrete5`

**Keywords:**
- "concrete5 developer"
- [concrete5 developer]
- "concrete cms developer"
- "concrete5 migration"
- "migrate concrete5"
- "concrete5 upgrade"
- "concrete cms upgrade"
- "concrete5 support"
- "concrete5 end of life"
- "concrete5 version 8"
- "concrete5 replacement"
- "concrete5 alternative"
- "concrete5 agency"
- "concrete5 expert"

**Headlines** (30 characters max; all checked):
1. Concrete5 Developer, US-Based
2. Concrete CMS Migration
3. Get Off Concrete5 v8 Safely
4. Keep Your Rankings & Content
5. Fixed Price, Real Deadline
6. Free Site Review & Quote
7. 15+ Years Full-Stack Dev
8. Your In-House Dev, No Hire
9. Concrete5 Support & Upgrades
10. Miss the Date, Stop Paying
11. One Accountable Developer
12. Code You Own, Documented

**Descriptions** (90 characters max; all checked):
1. No concrete5 v8 security patches since 2024, per Concrete CMS. I migrate it safely.
2. Content and search rankings carried over. Scope, price and date agreed in writing.
3. One remote, dedicated developer. Message me like a coworker; most changes live same day.
4. Free review of your concrete5 site and a written quote. No sales call needed to start.

## Campaign 2 — "Search · agency white-label" — $8/day
Landing page live since 2026-10-07: schottky.com/agencies. Updated 10/7: lead with PHP/TypeScript/React, never WordPress (he hates it).

Landing page: `https://schottky.com/agencies?utm_source=google&utm_medium=cpc&utm_campaign=agency`

**Keywords:**
- "white label web developer"
- "white label web development"
- "white label developer"
- "white label react developer"
- "white label php developer"
- "outsource web development for agencies"
- "agency web developer"
- "overflow web development"
- "subcontract web developer"
- "web development partner for agencies"
- "contract web developer for agency"

Display path: agencies / white-label

**Headlines:**
1. White-Label Web Developer
2. Overflow Dev for Agencies
3. Your Brand, My Code
4. PHP, TypeScript & React
5. Fixed Monthly, Not Hourly
6. Remote, Dedicated Developer
7. AI Integrations Included
8. 15+ Years Full-Stack
9. Stay Client-Facing
10. Builds & Client-Site Upkeep
11. Start Within Days
12. Free Intro Call

**Descriptions:**
1. Your team stays client-facing; I build and maintain client sites behind the scenes.
2. PHP, TypeScript and React builds, plus AI features, on a fixed monthly arrangement.
3. More client work than developer hours? Add a senior developer without adding payroll.
4. 15+ years full-stack. Most changes go live the same business day. Your name on the work.

## Budget and stop rule
- Total about $18/day, roughly $540/month.
- **Stop rule** (same idea as Meta): pause any campaign that spends **$300 with zero free-review requests or agency inquiries**, then rework the keywords or page before restarting.
- Check weekly on Fridays: search-terms report → add negatives, and look at spend, clicks and leads.
