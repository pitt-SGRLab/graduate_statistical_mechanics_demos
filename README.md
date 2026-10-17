# What is liquid structure?

An in-browser molecular dynamics demo that builds the radial distribution function g(r) step by step
(count neighbours -> compare to an ideal gas -> divide and average). 2D Lennard-Jones / repulsive-only
fluid, 320 particles, no dependencies, no build step.

## Deploy on GitHub Pages
1. Put `index.html`, `style.css`, `md.js`, `app.js` in a repo (root, or a `docs/` folder).
2. Settings -> Pages -> "Deploy from a branch" -> pick the branch and `/ (root)` (or `/docs`).
3. Your page appears at `https://<user>.github.io/<repo>/`.

Test locally: `python3 -m http.server` in this folder, then open http://localhost:8000

## Deep links (e.g. for a QR code on a worksheet)
`?preset=liquid|gas|solid|repulsive`, `rho=0.05..1.05`, `T=0.15..2`, `model=lj|wca`, `view=count|ideal|g`
Example: `index.html?preset=solid&T=0.4&view=g`

## Files
- `md.js`  : the MD engine (velocity Verlet, periodic box, Berendsen thermostat, g(r) histograms). Also runs in Node.
- `app.js` : UI, drawing, averaging, pointer handling.
