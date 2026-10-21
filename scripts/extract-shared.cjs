/* Idempotent extraction: keep dependency order and page-specific CSS intact. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const names = ['index.html','m42/index.html','m43/index.html','m78/index.html'];
const files = names.map(name => ({name,text:fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n')}));
if(files.every(file=>file.text.includes('orion-foundation.js')))process.exit(0);
const foundation = files.map(file=>[...file.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m=>m[1].includes('foundation v2')));
assert.ok(foundation.every(Boolean));assert.equal(new Set(foundation.map(m=>m[1])).size,1,'Shared foundation diverged');
fs.writeFileSync(path.join(root,'assets/orion-foundation.js'),foundation[0][1]);
const styles=files.map(file=>file.text.match(/<style[^>]*>([\s\S]*?)<\/style>/i));
let prefix=styles[0][1];
for(const match of styles.slice(1)){let i=0;while(i<prefix.length&&prefix[i]===match[1][i])i++;prefix=prefix.slice(0,i);}
prefix=prefix.slice(0,prefix.lastIndexOf('}')+1);assert.ok(prefix.length>9000);
fs.writeFileSync(path.join(root,'assets/orion-base.css'),prefix+'\n');
for(let i=0;i<files.length;i++){
 const {name}=files[i],asset=name.includes('/')?'../assets/':'assets/';let text=files[i].text;
 text=text.replace(foundation[i][0],'<script src="'+asset+'orion-foundation.js?v=20261020-1"></script>');
 text=text.replace(styles[i][0],'<link rel="stylesheet" href="'+asset+'orion-base.css?v=20261020-1"><style>'+styles[i][1].slice(prefix.length)+'</style>');
 text=text.replaceAll(asset+'lucide-0.468.0.min.js',asset+'orion-icons.js?v=20261020-1');
 text=text.replace(/(<svg\b[^>]*\bdata-lucide="sparkles"[^>]*>)[\s\S]*?<\/svg>/g,'$1<use href="'+asset+'orion-brand.svg#orion-logo"></use></svg>');
 text=text.replace(/(<button\b[^>]*\bid="navLogoBtn")([^>]*>)/g,'$1 aria-label="Orion BTP — Accueil"$2');
 fs.writeFileSync(path.join(root,name),text);
}
console.log('Shared foundation '+Buffer.byteLength(foundation[0][1])+' bytes; CSS base '+Buffer.byteLength(prefix)+' bytes');
