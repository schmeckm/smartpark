# Release-Workflow — so setzt ihr es um

Kurzfassung: **Commit-Konvention** → **Entwurf generieren** → **Version bumpen** → **Tag pushen** → **Build mit `GIT_COMMIT`**.

## 1. Commits einheitlich schreiben (5 Minuten Team-Abstimmung)

Empfohlen: [Conventional Commits](https://www.conventionalcommits.org/de/v1.0.0/)

| Präfix | Bedeutung | SemVer (Heuristik im Skript) |
|--------|-----------|------------------------------|
| `feat: …` | neues Verhalten / Feature | **minor** |
| `fix: …` | Bugfix | **patch** |
| `feat!: …` oder `BREAKING CHANGE:` im Body | API-/Vertragsbruch | **major** |
| `chore:`, `docs:`, … | ohne Nutzer-Feature | **patch** |

Beispiele:

```text
feat: mlFactorCurrents in Forecast-Summary ausliefern
fix: Regen-Bump bei rain_sensitive false überspringen
docs: RELEASE_VERSIONING um Automatisierung ergänzen
```

## 2. Release-Entwurf erzeugen (lokal)

```bash
npm run release:draft
```

Ausgabe: Markdown mit Commit-Liste seit **letztem Git-Tag** und Vorschlag `npm version patch|minor|major`.

Ohne Tag im Repo: die letzten **80** Commits (damit etwas Sinnvolles steht) — danach einmal `git tag v0.1.0` o. Ä. setzen.

## 3. Version wirklich erhöhen

Nach Review des Entwurfs:

```bash
npm version patch   # oder minor / major — erstellt Commit + Git-Tag
git push --follow-tags
```

Nur `package.json`-Zahl ohne Git-Commit vom Tool:

```bash
npm version patch --no-git-tag-version
```

## 4. GitHub: gleicher Entwurf in der Web-UI

Repository → **Actions** → **Release draft notes** → **Run workflow**.  
Die Zusammenfassung erscheint auf der Workflow-Run-Seite unter **Summary**.

## 5. Build / Übergabe

Siehe `docs/RELEASE_VERSIONING.md`: Image tag an `version` koppeln, optional `GIT_COMMIT` für `/health`.

## Optional später

- **release-please** (Google) oder **semantic-release**: öffnet PRs mit Version + Changelog — braucht mehr Repo-/Token-Setup.
- **commitlint** + Husky: erzwingt Commit-Format lokal — `npm i -D @commitlint/cli` (bewusst noch nicht im Projekt).
