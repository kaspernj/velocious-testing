# AGENTS

Guidance for every coding agent working in `@velocious/testing`.

## Package boundary

This package is independently versioned and independent of Velocious. It must never depend on, peer-depend on, import, dynamically resolve, or use Velocious source at runtime. Framework adapters belong in downstream packages. The root and `./runner` entry points are browser/Metro-safe and must not import Node built-ins or contain raw `import.meta` syntax; Node behavior belongs under `src/node` and the `./node` export.

The default context protocol major is public compatibility state. Changes to its global symbol, protocol major, schema, declarations, results, or event shapes require migration documentation and compatibility tests. Keep collaborators focused: importer, attempt executor, test argument resolver, and reporter.

## Development

Use ESM and checked JavaScript/JSDoc. Generated `build/` files come only from `npm run build`; never edit them directly. Add behavior tests before implementation and execute the focused RED before GREEN. Keep dependencies minimal and never add a CommonJS build.

All final package commands run inside the canonical Compose `dev` service. The source-independent image mounts the complete `${DEV_HOME_PATH:-/home/dev}` at `/home/dev`, runs as UID/GID 1000, and installs no repository dependencies while building.

Before handoff run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, package/bundle/standalone checks, `npm run verify:docker-dev-environment`, `docker compose config`, and `git diff --check`. TensorBuzz owns CI validation; do not add GitHub Actions workflows. Releases use `npm run release:patch`; do not manually version, publish, commit, or push unless explicitly authorized.

Document public changes in README, `docs/`, and `changelog.d/YYYYMMDDHHMMSS-slug.md` together.
