/**
 * Minimal static-site checks: no external assets, required SEO tags present,
 * JSON-LD parses, internal links resolve. No dependencies, no network.
 */
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const pages = fs.readdirSync(SITE).filter((f) => f.endsWith('.html'));

let failed = 0;
const fail = (msg) => { console.error('  x ' + msg); failed++; };
const ok = (msg) => console.log('  + ' + msg);

for (const page of pages) {
  const raw = fs.readFileSync(path.join(SITE, page), 'utf8');
  console.log(`\n${page}`);

  // required head tags
  const required = [
    ['<title>', /<title>[^<]{10,70}<\/title>/],
    ['meta description 50-165 chars', /<meta name="description" content="([^"]{50,165})"/],
    ['canonical', /<link rel="canonical" href="https:\/\/kharchangai\.github\.io\/Mocu\/[^"]*"/],
    ['og:title', /property="og:title"/],
    ['og:description', /property="og:description"/],
    ['og:image', /property="og:image"/],
    ['twitter:card', /name="twitter:card"/],
    ['viewport', /name="viewport"/],
    ['lang attribute', /<html lang="[a-z-]+"/],
  ];
  for (const [name, re] of required) {
    re.test(raw) ? ok(name) : fail('missing ' + name);
  }

  // a single h1
  const h1s = raw.match(/<h1[\s>]/g) || [];
  h1s.length === 1 ? ok('exactly one h1') : fail(`expected 1 h1, found ${h1s.length}`);

  // JSON-LD must parse
  const blocks = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    try { JSON.parse(body); ok('JSON-LD parses'); }
    catch (e) { fail('JSON-LD parse error: ' + e.message); }
  }

  // no remote dependencies (site must be self-contained and fast)
  const remote = [...raw.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('https://kharchangai.github.io/Mocu/') && !u.startsWith('https://github.com/'));
  remote.length === 0 ? ok('no external assets') : fail('external deps: ' + remote.join(', '));

  // internal links resolve to a file
  const local = [...raw.matchAll(/(?:href|src)="(?!https?:|#|mailto:)([^"#?]+)"/g)].map((m) => m[1]);
  for (const ref of new Set(local)) {
    const target = path.join(SITE, ref);
    fs.existsSync(target) ? ok('link ok: ' + ref) : fail('broken link: ' + ref);
  }
}

// sitemap must list every page
const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
console.log('\nsitemap.xml');
for (const page of pages) {
  const url = page === 'index.html'
    ? 'https://kharchangai.github.io/Mocu/'
    : 'https://kharchangai.github.io/Mocu/' + page;
  sitemap.includes(url) ? ok('listed: ' + url) : fail('missing from sitemap: ' + url);
}
console.log('\nrobots.txt');
fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8').includes('Sitemap:')
  ? ok('sitemap declared')
  : fail('robots.txt has no Sitemap line');

console.log(failed === 0 ? '\nAll site checks passed.' : `\n${failed} site check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
