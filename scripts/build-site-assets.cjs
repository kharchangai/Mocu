const fs = require('fs');

const files = ['site/index.html', 'site/install.html', 'site/fa.html'];

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  // OG/Twitter/JSON-LD absolute URLs -> optimized jpg
  t = t.split('https://kharchangai.github.io/Mocu/assets/mocugit.png')
       .join('https://kharchangai.github.io/Mocu/assets/og-image.jpg');
  // hero <img> -> optimized jpg with correct intrinsic size
  t = t.split('<img src="assets/mocugit.png" width="1721" height="914"')
       .join('<img src="assets/mocu-hero.jpg" width="1400" height="744"');
  fs.writeFileSync(f, t);
}

// add width/height + apple touch icon + preload for the hero on index
let h = fs.readFileSync('site/index.html', 'utf8');
h = h.replace(
  '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />\n<link rel="apple-touch-icon" href="assets/icon-180.png" />\n<link rel="preload" as="image" href="assets/mocu-hero.jpg" />'
);
h = h.replace('<meta property="og:image" content="https://kharchangai.github.io/Mocu/assets/og-image.jpg" />',
  '<meta property="og:image" content="https://kharchangai.github.io/Mocu/assets/og-image.jpg" />\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />\n<meta property="og:image:type" content="image/jpeg" />');
fs.writeFileSync('site/index.html', h);

let p = fs.readFileSync('site/fa.html', 'utf8');
p = p.replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />\n<link rel="apple-touch-icon" href="assets/icon-180.png" />\n<link rel="preload" as="image" href="assets/mocu-hero.jpg" />');
fs.writeFileSync('site/fa.html', p);

let i = fs.readFileSync('site/install.html', 'utf8');
i = i.replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />\n<link rel="apple-touch-icon" href="assets/icon-180.png" />');
fs.writeFileSync('site/install.html', i);

console.log('rewritten');
