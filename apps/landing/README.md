# MY Warranty — landing page

A single self-contained HTML file. No build step, no dependencies, no external
requests: every style, script, icon and screen mockup is inline.

## Look at it

```bash
open apps/landing/index.html          # macOS
xdg-open apps/landing/index.html      # Linux
start apps\landing\index.html         # Windows
```

Or serve it locally if you'd rather test it over HTTP:

```bash
cd apps/landing && python3 -m http.server 8080
# → http://localhost:8080
```

## Put it online

Because it's one static file, anything will host it. Point the deploy at
`apps/landing` as the publish directory:

| Host | How |
| --- | --- |
| **Netlify** | Drag the `apps/landing` folder onto the dashboard, or connect the repo with publish directory `apps/landing` and no build command |
| **Vercel** | Import the repo, set root directory to `apps/landing`, framework preset "Other" |
| **Cloudflare Pages** | Build output directory `apps/landing`, no build command |
| **GitHub Pages** | Settings → Pages → deploy from branch, then move or symlink the file to `/docs` |

No environment variables and no secrets are involved.

## What's in it

- Hero with a warranty counting down in real time — the app's whole promise in
  one object
- The problem, then the product's actual arc: **Capture → Know → Act**
- Every feature: four ways to add a product, receipt extraction, documents,
  search and filters, warranty detection with provenance, status and timeline,
  the four-stage reminder schedule, coverage checks with cited clauses, the
  claim assistant, service provider discovery, service history
- Seven real app screens with a light/dark toggle, including Hebrew RTL
- Privacy and data-ownership commitments
- Free / Plus / Pro pricing
- The four product rules, stated plainly

## Things to know before it goes public

**Pricing is indicative.** The $5 and $15 figures are the intended positioning,
labelled as such on the page. Real amounts are set per region in App Store
Connect and the Play Console — the app itself contains no price strings at all,
by design (see `docs/BILLING.md`).

**The call to action is a placeholder.** Every "Get early access" button is an
in-page anchor. Wire them to a signup form, a mailing list or the store listings
before this goes in front of the public.

**The screens are rendered, not screenshots.** They're built from the same
semantic tokens the app ships (`apps/mobile/src/theme/semantic.ts`), so they're
accurate to the design system. Once there are real builds on devices, swapping in
actual screenshots would be an easy improvement.

## Design notes

The page commits to one dark visual world rather than following the viewer's
system theme. Deep navy is the brand's resting state, and a dark ground is what
makes the light-mode product screens read as lifted, physical objects. Every
colour is painted explicitly, so nothing inherits from the host page.

Typography is deliberate about a constraint: the page loads no webfonts, so the
identity comes from the contrast between very large system-sans at tight negative
tracking and small wide-tracked monospace. The monospace does real work —
provenance lines, countdown digits, the reminder schedule.

The recurring thin `— source · confidence` line is the same trust device the app
uses, applied to the marketing page's own claims.

Verified at 1440px and 390px: no horizontal overflow, no console errors, and the
scroll reveal has a failsafe so an anchor jump can never land on invisible
content.
