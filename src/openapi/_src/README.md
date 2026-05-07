# `src/openapi/_src/` — Editable OpenAPI source (Phase A4)

The top-level **`src/openapi/openapi.yaml`** is a generated build artifact.
**Do not edit it by hand.** Edit the source files under this directory and
run `npm run build:openapi` to regenerate the monolith.

## Layout

```
_src/
├── openapi.yaml              # OpenAPI version + skeleton (rarely changes)
├── info.yaml                 # `info` block (title, version, contact, …)
├── servers.yaml              # `servers` block
├── tags.yaml                 # `tags` list (display order matters)
├── security.yaml             # root `security` + `components.securitySchemes`
├── components/
│   ├── schemas.yaml          # all `components.schemas` (single file for now)
│   ├── parameters.yaml       # all `components.parameters`
│   ├── responses.yaml        # all `components.responses`
│   └── examples.yaml         # (optional) all `components.examples`
└── paths/
    ├── ai.yaml               # paths under `/ai/...`
    ├── auth.yaml             # paths under `/auth/...`
    ├── integrations.yaml     # paths under `/integrations/...`
    ├── master-data.yaml      # paths under `/master-data/...`
    ├── …                     # one file per top-level resource family
    └── (39 path-family files in total)
```

## Editing rules

- **Paths**: add the new path to the matching family file. If a new
  top-level family is needed, add a new `_src/paths/<family>.yaml` —
  no script change required, the build picks it up automatically.
- **Schemas / parameters / responses**: edit the corresponding file
  under `components/`. The build deep-merges them into a single
  `components` block; conflicts (same key in two files) intentionally
  fail the build.
- **Tags**: add to `tags.yaml` so Swagger UI shows the section.
- **Security**: edit `security.yaml`; the root `security` array and
  the per-scheme `securitySchemes` definitions live together.

## Build / verify

```bash
# rebuild src/openapi/openapi.yaml from _src/
npm run build:openapi

# verify _src/ and openapi.yaml are in sync (used by CI)
npm run check:openapi-build
```

`npm run governance:ci` runs `check:openapi-build` automatically. CI
will fail any PR that edits `_src/` without committing the rebuilt
`openapi.yaml`, or vice versa.

## What "structurally equivalent" means

The drift gate (`scripts/build-openapi.mjs --check`) compares (a) the
OpenAPI version, (b) the set of paths, (c) the set of operations per
path, (d) every `components.schemas` / `parameters` / `responses` /
`securitySchemes` / `examples` key, (e) the tags list, and (f) the
server count. Byte-equality is **not** required — Phase A4
deliberately rejected that constraint because the YAML emitter does
not perfectly round-trip the original file's whitespace and key
ordering. The structural compare catches any meaningful change.

## When was this introduced?

Phase A4 (audit ticket A4) — the monolith `openapi.yaml` had grown to
8.5k lines and was the #1 source of merge conflicts. The split
preserves a single served document while making each path family /
component group editable in isolation.
