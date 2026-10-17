# Interactive physical chemistry demos

Static site (plain HTML/JS/CSS, no build step) for GitHub Pages.

    index.html                      landing page listing the demos
    shared/base.css                 theme (light/dark), typography, cards: shared by all pages
    demos/liquid-structure/         demo 1: building g(r) for a gas, liquid and solid
        index.html  style.css  md.js  app.js

## Adding a demo
1. Copy `demos/liquid-structure/` to `demos/<name>/` and edit it (link `../../shared/base.css` for the common look).
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
