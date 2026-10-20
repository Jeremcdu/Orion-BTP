/* Lucide 0.468.0, ISC/MIT: preserve the project's original icon definitions.
 * Render only static HTML; the existing runtime still handles dynamic icons. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lucide = require(path.join(root, 'assets/lucide-0.468.0.min.js'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
function render([tag, attributes, children = []]) {
  return '<' + tag + ' ' + Object.entries(attributes).map(([k,v]) => k + '="' + escape(v) + '"').join(' ') + '>' + children.map(render).join('') + '</' + tag + '>';
}
let count = 0;
for (const filename of ['index.html', 'm42/index.html', 'm43/index.html', 'm78/index.html']) {
  const file = path.join(root, filename), html = fs.readFileSync(file, 'utf8');
  const chunks = html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/gi);
  const output = chunks.map(chunk => /^<script\b/i.test(chunk) ? chunk : chunk.replace(/<i\b([^>]*\bdata-lucide="([a-z0-9-]+)"[^>]*)>\s*<\/i>/g, (full, raw, name) => {
    const key = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const definition = lucide.icons[key]; if (!definition) throw new Error('Missing icon: ' + name);
    const attributes = Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    count++; return render([definition[0], {...definition[1], ...attributes, 'aria-hidden':'true'}, definition[2]]);
  })).join('');
  fs.writeFileSync(file, output);
}
console.log(count + ' static icons rendered');
