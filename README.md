# Interactive physical chemistry demos

Static site (plain HTML/JS/CSS, no build step) for GitHub Pages.

    index.html                      landing page listing the demos
    shared/base.css                 theme (light/dark), typography, cards: shared by all pages
    shared/demo.css                 layout for demo pages (toolbar, panels, sliders, stats)
    shared/harddisks.js             exact event-driven hard-disk engine (gas demos)
    shared/hd-demo.js               UI for the gas demos (<body data-hd="temperature|count">)
    demos/liquid-structure/         building g(r) for a gas, liquid and solid  (md.js, app.js)
    demos/kinetic-kick/             click an atom to add energy; trace = temperature
    demos/left-side-of-box/         all atoms start on the left; trace = atoms in the left half
    demos/time-reversal/            beam of atoms; Reverse-time button; trace = coarse-grained entropy and t (app.js)

## Adding a demo
1. Copy a demo folder to `demos/<name>/` and edit it (link `../../shared/base.css` and `../../shared/demo.css` for the common look).
2. Add a card (copy the `<li class="card demo">`) to the root `index.html`.

## Deploy on GitHub Pages
Push everything to a repo, then Settings -> Pages -> deploy from branch (root).
The site appears at `https://<user>.github.io/<repo>/`.
Test locally: `python3 -m http.server` in this folder, open http://localhost:8000

## Liquid-structure demo
Move the mouse over the box (or across the plot) to set the distance r from the reference particle;
click a particle to make it the reference. Deep links, e.g. for a QR code on a worksheet:
`demos/liquid-structure/index.html?preset=solid&T=0.4&view=g`
options: `preset` = gas|liquid|solid|repulsive, `rho` 0.05-1.05, `T` 0.15-2, `model` = lj|wca, `view` = count|ideal|g

## Gas demos
Deep links: `?n=20&kick=6&speed=2` (atoms 10-150, kick strength 0.5-8, playback speed 0.25-3).

## Time-reversal demo
`demos/time-reversal/index.html?n=40&digits=16&speed=2` (atoms 20-100, digits 3-16 = decimal places kept after each step, speed 0.25-4).
Reversal = flipping every velocity; the step counter k (t = k*dt) counts down while the plots' elapsed time keeps running forward.
Engine additions in `shared/harddisks.js`: `initBeam`, `reverseVelocities`, `quantize`, `saveInitial`, `rmsFromInitial`.
