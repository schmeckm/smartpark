/**
 * Validates shared/rbac.json and ensures backend rbac module matches the manifest.
 * Also checks admin-dashboard rbac.ts imports the shared manifest (no drift).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'shared', 'rbac.json');
const dashboardManifestPath = path.join(root, 'admin-dashboard', 'shared', 'rbac.json');
const rbacTsPath = path.join(root, 'admin-dashboard', 'src', 'constants', 'rbac.ts');

function assertUniqueSorted(name, arr) {
  if (!Array.isArray(arr)) throw new Error(`${name} must be an array`);
  const seen = new Set();
  for (const x of arr) {
    if (typeof x !== 'string' || !x.trim()) throw new Error(`${name} has invalid entry`);
    if (seen.has(x)) throw new Error(`${name}: duplicate key "${x}"`);
    seen.add(x);
  }
}

function validateManifest(m) {
  assertUniqueSorted('roles', m.roles);
  assertUniqueSorted('permissions', m.permissions);
  const roleSet = new Set(m.roles);
  const permSet = new Set(m.permissions);

  if (!m.rolePermissions || typeof m.rolePermissions !== 'object') {
    throw new Error('rolePermissions must be an object');
  }

  for (const role of m.roles) {
    if (!(role in m.rolePermissions)) {
      throw new Error(`rolePermissions missing entry for role "${role}"`);
    }
  }

  for (const role of Object.keys(m.rolePermissions)) {
    if (!roleSet.has(role)) {
      throw new Error(`rolePermissions has unknown role "${role}" (not in roles[])`);
    }
    const entry = m.rolePermissions[role];
    if (entry === 'ALL') continue;
    if (!Array.isArray(entry)) {
      throw new Error(`rolePermissions["${role}"] must be "ALL" or string[]`);
    }
    const seenPerm = new Set();
    for (const p of entry) {
      if (!permSet.has(p)) {
        throw new Error(`role "${role}" references unknown permission "${p}"`);
      }
      if (seenPerm.has(p)) throw new Error(`role "${role}" has duplicate permission "${p}"`);
      seenPerm.add(p);
    }
  }

  if (Array.isArray(m.navigationGroups)) {
    for (const g of m.navigationGroups) {
      if (!g.id || !g.titleKey || !Array.isArray(g.items)) {
        throw new Error(`navigationGroups: invalid group ${JSON.stringify(g?.id)}`);
      }
      for (const it of g.items) {
        if (!it.to || !it.labelKey || !it.permission?.resource || !it.permission?.action) {
          throw new Error(`navigationGroups: invalid item in group "${g.id}"`);
        }
        const pk = `${it.permission.resource}.${it.permission.action}`;
        if (!permSet.has(pk)) {
          throw new Error(`nav item ${it.to} uses permission "${pk}" not listed in permissions[]`);
        }
      }
    }
  }
}

function deepEqualRolePermissions(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  assert.deepStrictEqual(ak, bk, 'ROLE_PERMISSIONS keys differ from manifest.rolePermissions');
  for (const k of ak) {
    assert.deepStrictEqual(a[k], b[k], `ROLE_PERMISSIONS["${k}"] differs from manifest`);
  }
}

function main() {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  validateManifest(manifest);

  const dashRaw = fs.readFileSync(dashboardManifestPath, 'utf8');
  const dashParsed = JSON.parse(dashRaw);
  assert.deepStrictEqual(
    dashParsed,
    manifest,
    'admin-dashboard/shared/rbac.json must match shared/rbac.json (run: npm run sync:rbac)',
  );

  const rbac = require(path.join(root, 'src', 'constants', 'rbac.js'));
  deepEqualRolePermissions(rbac.ROLE_PERMISSIONS, manifest.rolePermissions);

  const rolesObj = rbac.ROLES;
  for (const code of manifest.roles) {
    assert.strictEqual(rolesObj[code], code, `ROLES missing or wrong for "${code}"`);
  }

  const rbacTs = fs.readFileSync(rbacTsPath, 'utf8');
  if (!rbacTs.includes("from '../../shared/rbac.json'")) {
    throw new Error('admin-dashboard/src/constants/rbac.ts must import ../../shared/rbac.json');
  }
  if (!rbacTs.includes('navigationGroups')) {
    throw new Error('admin-dashboard rbac.ts should export navigationGroups from manifest');
  }

  console.log('verify-rbac-sync: OK (manifest, backend, frontend import)');
}

main();
