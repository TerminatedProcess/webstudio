# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Webstudio is an open-source visual development platform. A user visually builds a site; the site is stored as normalized data and can be rendered live (in the builder canvas) or code-generated into a deployable Remix / React-Router / SSG app (via the CLI).

pnpm workspace, **Node 22**, `pnpm@9`, ESM-only (`type: module`). One app (`apps/builder`, a Remix app) plus ~35 packages under `packages/`, and `fixtures/*` (real generated sites built in CI to verify codegen).

## Commands

```bash
pnpm dev                 # start the builder: boots docker (postgres + postgrest), bootstraps DB, runs builder dev server
pnpm build               # build all packages except fixtures
pnpm checks              # full CI gate: pnpm -r test && typecheck && lint && fixtures
pnpm lint                # oxlint --deny-warnings (fast; not eslint)
pnpm format              # prettier --write

# Per-package (use the workspace filter):
pnpm --filter=@webstudio-is/sdk test          # run one package's vitest suite
pnpm --filter=@webstudio-is/sdk typecheck     # tsgo --noEmit (typescript native-preview, NOT tsc)
pnpm --filter=@webstudio-is/builder dev       # builder only (assumes DB already up)

# Single test file / test name (vitest):
pnpm --filter=@webstudio-is/sdk exec vitest run src/expression.test.ts
pnpm --filter=@webstudio-is/sdk exec vitest run -t "test name substring"

pnpm migrations          # generate prisma client + run dev migrations
pnpm fixtures            # regenerate + build fixture sites (codegen end-to-end check)
pnpm e2e:builder         # playwright e2e against a local stack
```

Local dev auth: `.env` ships `DEV_LOGIN=true` so you can log in without OAuth. The builder DB stack runs in docker via `apps/builder/docker-compose*.yaml`; `apps/builder/dev/backend.sh` orchestrates start/bootstrap/migrate.

## Critical: the `webstudio` export condition

Almost every package's `exports` map has a `"webstudio"` key pointing at **raw TypeScript source** (`./src/index.ts`) alongside the normal `"import"` key that points at the built `./lib/`. Tooling runs with `--conditions=webstudio` (via `tsx --conditions=webstudio`, `NODE_OPTIONS`, esbuild flags, and `vitest.config.ts`), so **cross-package imports resolve to uncompiled `.ts` source** — no build step needed to run tests, typecheck, the CLI, or codegen.

Consequence: if you run any script that touches multiple packages and it fails resolving a package, it's likely missing `--conditions=webstudio`. Don't "fix" it by running `pnpm build` first — set the condition. Consumers outside this repo get the normal `import`→`lib` build.

## Core data model (`packages/sdk`)

User site data is a set of **normalized Zod-defined `Map`s keyed by id** (`WebstudioData`, `packages/sdk/src/schema/webstudio.ts`), NOT a nested tree. Schemas live in `packages/sdk/src/schema/*`; the schema-only entrypoint is `packages/sdk/src/schema.ts`.

- **instances** — the component tree, flat map linked by id. Each `Instance` has `component` (e.g. `"Box"`) and `children`, where a child is `{type:"id"}` (link to another instance), `{type:"text"}`, or `{type:"expression"}`.
- **props** — component properties (discriminated union by value type), each pointing at an `instanceId`.
- **styleSources** (`token` = named/shared, like a CSS class; `local` = per-instance) + **styleSourceSelections** (`Map<instanceId, styleSourceId[]>`, the cascade order) + **styles** (declarations keyed by `styleSourceId:breakpointId:property:state`) + **breakpoints**. Styles attach to _style sources_, not instances; instances inherit them via selections.
- **dataSources** (reactive variables/parameters/resources) + **resources** (external REST fetches) + **props** — the reactivity layer. Expressions are strings parsed with acorn (`packages/sdk/src/expression.ts`).
- **pages**, **assets**.

`WebstudioFragment` is the array-form (not Maps) transferable shape used for copy/paste, templates, and the marketplace.

## Package relationships

- `sdk` — data schema + framework-agnostic runtime/utilities. The foundation everyone imports.
- `protocol` — thin wire-contract wrapper over the sdk schema (public HTTP API / CLI sync).
- `react-sdk` — React runtime + **code generator** (`generateWebstudioComponent`, `generateCss`, resource/loader gen). Turns `WebstudioData` into a running/emitted React tree.
- `sdk-components-react` — the default component library (Box, Button, Form, Image...). Each component = `.tsx` + a `.ws.ts` meta file. Instances' `component` field resolves here.
  - `sdk-components-react-radix` — additive Radix-based interactive components.
  - `sdk-components-react-remix` vs `sdk-components-react-router` — mutually exclusive framework targets providing the same nav/form overrides (Link, Form) for Remix vs React-Router.
  - `sdk-components-animation` — proprietary (EULA-gated), a git submodule; not part of the AGPL core.

Flow: `sdk` (data) → `react-sdk` (render/generate) → `sdk-components-*` (concrete components).

## The builder app (`apps/builder`, Remix)

`app/` layout: `builder/` (editor UI), `canvas/` (renders inside the iframe), `dashboard/`, `auth/`, `routes/`, `shared/` (most logic).

**Builder ↔ Canvas:** the canvas is a **same-origin iframe** (route `_canvas.canvas.tsx`). State is NOT passed by props — both sides share the same nanostores atoms and immerhin stores, synchronized through an in-window `SyncEmitter`. The builder is the sync **leader**; the canvas is a **follower**.

**State:**

- **nanostores** — reactive atoms in `app/shared/nano-states/*` (`$instances`, `$props`, `$styles`, `$styleSources`, `$breakpoints`, `$pages`, `$assets`, `$dataSources`, plus UI atoms). Data atoms: `app/shared/sync/data-stores.ts`.
- **immerhin** — transactional undo/redo over immer. Two stores: `serverSyncStore` (persisted) and `clientSyncStore`. `enableMapSet()` is on because the model is `Map`s.
- To make a new atom sync across builder/canvas/server, register it in the **object pool** (`createObjectPool`, `app/shared/sync/sync-stores.ts`) as a `NanostoresSyncObject` / `ImmerhinSyncObject`.
- Sync engine: `app/shared/sync/*` (`sync-client.ts`, single vs multiplayer clients, queues) built on `packages/sync-client`. Wire message types: `packages/multiplayer-protocol` (zero-dep). Multiplayer relays transactions over WebSocket; single-user uses the same immerhin pipeline persisting to the server queue.

## Persistence

- **`packages/prisma-client`** — Prisma schema/migrations for the **metadata** DB (projects, users, auth, deployments).
- **`packages/project-build`** — owns **user site data**. `src/db/build.ts` reads/writes the `Build` table row, where each part of the model is a **serialized JSON string column** (`serializeData`/`parseData`). Also runs `migratePages` (`packages/project-migrations`) on read, and breaks Slot-induced graph cycles (`breakCyclesMutable`). Also holds runtime mutation helpers, builder state machine, and the MCP server (`src/mcp.ts`).
- **`packages/postgrest`** — typed `@supabase/postgrest-js` client over generated DB types. The **runtime data-access path**: server code queries Postgres over HTTP through PostgREST, not Prisma at request time.
- **`packages/trpc-interface`** — the auth/API-compatibility seam (`AppContext`, `authorizeProject`, `AuthorizationError`), plans-aware via `packages/plans`. Decouples the OSS core from a pluggable backend.

## Code generation & CLI

`packages/cli` (published as `webstudio`) pulls a project and generates a deployable app. Generator: `src/prebuild.ts`, picking a framework (`framework-remix.ts` / `framework-react-router.ts` / `framework-vike-ssg.ts`), writing an `__generated__/` dir via `react-sdk`'s generators. Deploy templates: `packages/cli/templates/*` (one per target: `react-router`, `react-router-vercel`, `ssg`, `cloudflare`, etc.). `fixtures/*` are real generated projects built in CI to verify codegen.

## Conventions

- **Lint** is `oxlint` (not eslint). Enforced: kebab-case filenames, no `any`, `func-style: expression` (arrow functions), `eqeqeq`, node: protocol imports. `pnpm lint` denies warnings.
- **Typecheck** uses `tsgo` (`@typescript/native-preview`), not `tsc`.
- Prettier runs pre-commit via `nano-staged` / `simple-git-hooks`. `trailingComma: es5`, `babel-ts` parser for TS.
- Tests are **vitest**; server-condition tests run with the `webstudio` resolve condition (already set in `vitest.config.ts`).
- Component metas: adding/altering an sdk component means updating both its `.tsx` and its `.ws.ts` meta.
