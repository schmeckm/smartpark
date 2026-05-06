#!/usr/bin/env node
/**
 * Liest Git-Commits seit dem letzten Tag und erzeugt Markdown für Release-Notizen + SemVer-Hinweis.
 * Voraussetzung: sinnvolle Commit-Messages (ideal: Conventional Commits: feat:, fix:, chore:, …).
 *
 * Usage: node scripts/release-draft.mjs
 *    or: npm run release:draft
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function lastTag() {
  try {
    return sh('git describe --tags --abbrev=0');
  } catch {
    return '';
  }
}

function pkgVersion() {
  const p = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return String(p.version || '0.0.0');
}

function logOneline(sinceTag) {
  try {
    if (sinceTag) {
      return sh(`git log ${sinceTag}..HEAD --oneline --no-decorate`);
    }
    return sh('git log HEAD -n 80 --oneline --no-decorate');
  } catch {
    return '';
  }
}

/** Grobe SemVer-Empfehlung aus erstem Token der Subject-Zeile (nach Hash). */
function suggestBump(lines) {
  let major = 0;
  let minor = 0;
  let patch = 0;
  for (const line of lines) {
    const subject = line.replace(/^[a-f0-9]+\s+/i, '').trim();
    if (/^BREAKING CHANGE|^[^:]+!:/.test(subject) || /^[a-z]+!:/i.test(subject)) {
      major += 1;
      continue;
    }
    if (/^feat(\([^)]*\))?:/i.test(subject)) minor += 1;
    else if (/^fix(\([^)]*\))?:/i.test(subject)) patch += 1;
    else patch += 1;
  }
  if (major) return 'major';
  if (minor) return 'minor';
  return 'patch';
}

function main() {
  const tag = lastTag();
  const raw = logOneline(tag);
  const lines = raw ? raw.split('\n').filter(Boolean) : [];

  const version = pkgVersion();
  const bump = suggestBump(lines);

  const out = [];
  out.push(`## Release-Entwurf`);
  out.push('');
  out.push(`- **Aktuelle package.json-Version:** \`${version}\``);
  out.push(`- **Letzter Git-Tag (Basis):** ${tag ? `\`${tag}\`` : '_keiner — alle untenstehenden Zeilen aus letzten 80 Commits_'}`);
  out.push(`- **Empfohlener nächster Bump (nur Heuristik):** \`${bump}\` → danach \`npm version ${bump}\` prüfen und ggf. anpassen`);
  out.push('');
  out.push('### Commits');
  out.push('');
  if (!lines.length) {
    out.push('_Keine Commits seit dem Tag (oder kein Git-Repo / shallow clone)._');
  } else {
    for (const line of lines) {
      out.push(`- ${line}`);
    }
  }
  out.push('');
  out.push('### Nächste Schritte (manuell)');
  out.push('');
  out.push('1. Text oben für Kunden/Interne Release-Notes kopieren und kürzen.');
  out.push(`2. Version setzen: \`npm version ${bump}\` (erstellt Commit + Tag) **oder** nur \`npm version ${bump} --no-git-tag-version\` wenn ihr Tag selbst macht.`);
  out.push('3. `git push` und Tags: `git push --follow-tags`');
  out.push('4. Docker/CI: `GIT_COMMIT` setzen (siehe `docs/RELEASE_VERSIONING.md`).');
  out.push('');

  const text = out.join('\n');
  process.stdout.write(text);
}

main();
