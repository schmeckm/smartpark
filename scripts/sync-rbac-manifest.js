/**
 * Copies repo-root shared/rbac.json → admin-dashboard/shared/rbac.json
 * (Vite resolves the dashboard copy inside /app; CI verifies both stay identical).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'shared', 'rbac.json');
const dest = path.join(root, 'admin-dashboard', 'shared', 'rbac.json');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('sync-rbac-manifest: copied shared/rbac.json → admin-dashboard/shared/rbac.json');
