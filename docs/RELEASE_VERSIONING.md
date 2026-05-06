# Release-Versionierung (Releasestand)

Ziel: Mit jeder Auslieferung ein **klares Versionslabel** und optional den **Git-Stand** mitgeben — für Support, Abnahme und parallele Umgebungen.

**Schritt-für-Schritt im Alltag:** siehe **[RELEASE_HOWTO.md](./RELEASE_HOWTO.md)** (Commits → `npm run release:draft` → `npm version`).

## 1. SemVer (Hauptversion)

- **Quelle der Wahrheit:** `package.json` im **Repository-Root** (`version`, z. B. `0.2.0`).
- **API:** `GET /health` und `GET /api/v1/health` liefern `data.version` und `data.apiVersion` (`v1`). Wenn gesetzt, zusätzlich `data.gitCommit`.
- **Admin-UI (Build):** Vite setzt `import.meta.env.VITE_REPO_VERSION` und `import.meta.env.VITE_GIT_COMMIT` aus Root-`package.json` bzw. Umgebungsvariable `GIT_COMMIT` zum **Build-Zeitpunkt**.

Befehl zum Anzeigen:

```bash
npm run print:version
```

Release-Bump (Beispiel):

```bash
npm version patch   # oder minor / major — aktualisiert package.json (+ ggf. package-lock)
git push --follow-tags
```

Git-Tag passend zur Version (empfohlen):

```bash
git tag "v$(node -p \"require('./package.json').version\")"
git push origin "v$(node -p \"require('./package.json').version\")"
```

## 2. Exakter Quell-Stand (`gitCommit`)

In **CI/CD** oder `.env` (nicht committen, wenn geheim):

- `GIT_COMMIT` — Kurz-SHA oder voller Commit (wie eure Pipeline liefert).
- Alternativ: `SOURCE_COMMIT` (wird vom Backend ebenfalls gelesen).

**Docker Compose** reicht `GIT_COMMIT` aus der Host-Umgebung an die Services `api` und `frontend` durch (siehe `docker-compose.yml`). Beispiel:

```bash
set GIT_COMMIT=abc123def
docker compose up --build
```

Oder in `.env` (lokal):

```text
GIT_COMMIT=abc123def
```

## 3. Was ist nicht dieselbe Zahl?

- **`/api/v1/...`** — URL-Generation des HTTP-APIs (Breaking Changes → ggf. `v2` später).
- **`openapi.yaml` → `info.version`** — Dokumentations-/Contract-Version der OpenAPI-Datei; bei reinen Feature-Erweiterungen oft nur Patch erhöhen; bei Contract-Bruch bewusst anheben.
- **Root `package.json` version** — empfohlenes **Release-/Produkt-Label** für Kunden und Images.

## 4. Releasestand „mitgeben“

Minimal für eine Übergabe:

| Artefakt | Inhalt |
|----------|--------|
| Docker-Image(s) | Tag z. B. `smart-park-api:0.2.0` |
| `version` | Aus `npm run print:version` oder `GET …/health` → `data.version` |
| Optional | `data.gitCommit` nach gesetztem `GIT_COMMIT` |

Release-Notes: pro Release kurz die **Features** listen (z. B. im Ticket oder `CHANGELOG` im Team-Standard — im Repo optional).

## 5. Frontend optional anzeigen

Ergänzung in einer Vue-Komponente (z. B. Hilfe/Footer), wenn gewünscht:

```ts
const release = `${import.meta.env.VITE_REPO_VERSION || '?'}${import.meta.env.VITE_GIT_COMMIT ? ` (${import.meta.env.VITE_GIT_COMMIT})` : ''}`
```

Nach **neuer** `GIT_COMMIT`-Angabe das Frontend-Image neu bauen, damit `VITE_GIT_COMMIT` im Bundle steckt.

## 6. „Agent“: Features erkennen, beschreiben, Version hochziehen

**Kurz:** Vollautomatisch „neue Features in der App erkennen“ nur aus laufendem Code ist **unzuverlässig** (false positives, keine Abnahme-Logik). Üblich ist ein **hybrider** Weg: maschinenlesbare Signale vom Menschen oder von der Pipeline, dazu LLM für Text.

### Was realistisch funktioniert

| Ansatz | Erkennung / Beschreibung | Version |
|--------|---------------------------|---------|
| **Conventional Commits** (`feat:`, `fix:`, `BREAKING CHANGE:`) | Commit-Messages = strukturierte Feature-Hinweise; Changelog-Generator (`conventional-changelog`) oder **semantic-release** / **release-please** erzeugt Einträge und **SemVer** (minor/patch/major) nach Regeln. | Automatisch bumpen in CI nach Merge auf `main` möglich. |
| **GitHub/GitLab + PR-Titel/-Body** | PR-Template mit „Release notes:“; Action sammelt PRs seit letztem Tag und füllt `CHANGELOG` oder Release-Draft. | Manueller oder automatisierter `npm version` Schritt. |
| **Cursor / IDE-Agent** (z. B. nach größerem Merge) | Agent liest `git diff`, OpenAPI, `client.ts`-Typen und formuliert Release-Text **zum Review** — ihr merged die Beschreibung, Version bump bleibt bewusst. | Ihr lasst den Agent `npm version patch` vorschlagen oder führt es selbst aus. |
| **Rein heuristisch (ohne Mensch)** | z. B. nur „diff groß → minor“ — **riskant**, nicht empfohlen für Kundenreleases. | — |

### Empfehlung für Smart Park OS

1. **Team:** [Conventional Commits](https://www.conventionalcommits.org/) durchsetzen (oder PR-Labels `feature` / `breaking`).
2. **CI:** z. B. **release-please** oder ein einfacher Job: „bei Tag `v*` oder manuellem `workflow_dispatch`“ → `npm version`, Tag pushen, `GIT_COMMIT` in Build injizieren (habt ihr schon vorbereitet).
3. **Beschreibung:** Release-Draft aus PR-Titeln **oder** einmalig Cursor-Agent: „Fasse die Änderungen seit Tag v0.1.0 für Kundenrelease zusammen“ — immer **human review** vor Veröffentlichung.

Ein **einziger autonomer Agent**, der dauerhaft im Hintergrund „die App scannt“, ist technisch möglich (Scheduled Job + LLM + Repo-Clone), bindet aber Geheimnisse, Kosten und Governance ein — für die meisten Teams reicht **CI + Commit-Konvention + optional LLM auf dem Diff vor dem Release**.
