/* Run the real auth bootstrap against a minimal DOM and a mocked access API.
 * These checks exercise menu order and visibility; they do not render a browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../assets/orion-auth.js'), 'utf8');
function page(profile, deferred = false) {
  const nodes = new Map();
  const make = id => {
    const node = { children: [], className: '', setAttribute() {}, append(child) { this.children.push(child); }, insertBefore(child, anchor) { const i = this.children.indexOf(anchor); this.children.splice(i < 0 ? this.children.length : i, 0, child); } };
    Object.defineProperty(node, 'id', { get() { return id; }, set(value) { id = value; nodes.set(value, node); } });
    if (id) nodes.set(id, node); return node;
  };
  const menu = make('userDropdownMenu'), info = make('accountInfo'), actions = make('actions'), logout = make('logout');
  actions.append(make('dropdownPrivacyBtn')); logout.append(make('dropdownLogoutBtn'));
  menu.append(info); menu.append(actions); menu.append(logout);
  let release;
  const wait = deferred ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const context = {
    URL, setTimeout, clearTimeout, localStorage: { getItem: () => null },
    document: { readyState: 'complete', currentScript: { src: 'https://example.invalid/Orion-BTP/assets/orion-auth.js' }, documentElement: { dataset: { orionModule: '' }, classList: { toggle() {} } }, addEventListener() {}, getElementById: id => nodes.get(id), createElement: () => make() },
    ORION_CONFIG: { url: 'https://example.invalid', publishableKey: 'sb_publishable_test' },
    supabase: { createClient: () => ({ auth: { onAuthStateChange() {}, getUser: async () => { await wait; return { data: { user: profile ? { id: 'qa-user' } : null } }; } }, rpc: async () => ({ data: profile }) }) },
  };
  context.window = context; vm.runInNewContext(source, context);
  return { context, menu, nodes, release };
}
const actions = menu => menu.children.flatMap(child => child.children).map(child => child.id);
(async () => {
  let count = 0;
  for (const [name, profile] of [
    ['Invité', null], ['Compte ordinaire', { user: { id: 'qa-user' }, is_admin: false }], ['Administrateur', { user: { id: 'qa-user' }, is_admin: true }],
  ]) {
    const p = page(profile); await p.context.OrionReady; await Promise.resolve();
    const expected = ['orionMenuAccountLink', ...(profile?.is_admin ? ['orionMenuAdminLink'] : []), 'dropdownPrivacyBtn', 'dropdownLogoutBtn'];
    assert.deepEqual(actions(p.menu), expected);
    assert.equal(p.nodes.get('orionMenuAccountLink').href, 'https://example.invalid/Orion-BTP/compte.html?mode=login');
    if (profile?.is_admin) assert.equal(p.nodes.get('orionMenuAdminLink').href, 'https://example.invalid/Orion-BTP/compte.html?mode=admin');
    console.log('PASS', name + ' : ordre, accès et destinations du menu'); count++;
  }
  const p = page({ user: { id: 'qa-user' }, is_admin: true }, true);
  assert.deepEqual(actions(p.menu), ['orionMenuAccountLink', 'dropdownPrivacyBtn', 'dropdownLogoutBtn']);
  p.release(); await p.context.OrionReady; await Promise.resolve();
  await assert.rejects(p.context.OrionAuth.waitFor(new Promise(()=>{}), 1), /timeout/);
  assert.equal(await p.context.OrionAuth.waitFor(Promise.resolve('ready'), 100), 'ready');
  assert.deepEqual(actions(p.menu), ['orionMenuAccountLink', 'orionMenuAdminLink', 'dropdownPrivacyBtn', 'dropdownLogoutBtn']);
  console.log('PASS Administration reçue après chargement : reste avant les autres commandes'); count++;
  console.log(count + '/' + count + ' tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
