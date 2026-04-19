# Template Hub

This repository contains the Grafana app plugin `greg00r-templatehub-app`, branded as `Template Hub`.

It is an app plugin with:
- a React/TypeScript frontend,
- a Go backend built on `grafana-plugin-sdk-go`,
- local storage for dashboard templates,
- UI flows for importing and uploading templates.

This repository does not contain the Helm chart or the local Minikube deployment. Those live in the sibling repo `../grafana-local`.

## What the plugin does

Template Hub provides an internal dashboard template hub inside a Grafana instance:

- it shows a gallery of reusable templates,
- it provides a template detail view,
- it imports a template as a new dashboard into a selected folder,
- it asks for variables before import,
- it lets users publish a new template from the UI,
- it stores templates locally, with an abstraction layer ready for an external backend later.

## How it works

There are three layers:

1. Frontend
- renders the gallery, detail view, import flow, and upload wizard,
- fetches templates from `/api/plugins/greg00r-templatehub-app/resources/*`,
- uses the native Grafana API `POST /api/dashboards/db` during import.

2. Backend
- runs inside Grafana as the backend part of the app plugin,
- handles plugin resource endpoints,
- reads and writes template bundles through the storage layer,
- does not need a separate HTTP service in local mode.

3. Storage
- local mode stores files on the Grafana filesystem,
- external mode is abstracted behind an interface, but is still a stub in this repository.

## Where templates are stored

The default local storage path is:

```text
/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates
```

This is defined in:

- `pkg/plugin/models.go`
- `DefaultLocalPath = "/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates"`

The plugin also includes backward compatibility for older installs:

- if it finds existing data under `/var/lib/grafana/plugins-data/gregoor-private-marketplace-app/templates`,
- it will try to migrate that data automatically to the new `Template Hub` path.

Each template is stored in its own directory:

```text
<templates_root>/
  <template_id>/
    template.json
    metadata.json
    variables.json
    image.png / image.jpg / image.webp / ...
```

During upload, the plugin stores:

- `template.json` as the dashboard JSON,
- `metadata.json` as title, descriptions, tags, required datasources, and related metadata,
- `variables.json` as the import form definition,
- `image.*` as the preview image if one was provided.

## What happens during import

Import is mostly handled by the frontend plus the native Grafana API:

1. the frontend fetches `template.json`, `metadata.json`, and `variables.json`,
2. the user fills in variables and selects a folder,
3. the frontend prepares the dashboard model for import,
4. the frontend sends the final payload to Grafana through `POST /api/dashboards/db`.

Important details:

- the backend plugin does not write dashboards directly into the Grafana database,
- the backend plugin only serves and stores template bundles,
- dashboard creation itself uses the official Grafana API,
- the plugin exposes import to users who can access the app, but the final dashboard save still respects Grafana folder and dashboard permissions.

## What happens during upload

Upload is a combination of frontend and backend behavior:

1. the frontend collects dashboard JSON, metadata, variables, and an optional image,
2. the frontend sends the payload to:

```text
/api/plugins/greg00r-templatehub-app/resources/templates
```

3. the backend validates the payload,
4. the backend stores the bundle,
5. the new template appears in the appropriate queue or gallery.

Upload is restricted to `Editor` and `Admin` roles by default:

- the frontend hides upload actions from `Viewer`,
- the `/upload` page shows an access guard in the UI,
- the backend also enforces authorization, so the frontend is not the only protection layer.

## Is this only plugin runtime work?

From a runtime perspective, yes.

In normal operation there is no sidecar and no separate backend service.

The runtime consists of:

- the frontend bundle loaded in the browser,
- the backend plugin binary started by Grafana,
- the local filesystem directory used for template storage.

So in practice:

- no sidecar for plugin requests,
- no separate API container in local mode,
- no separate database for the plugin itself.

## Is there any extra container involved?

Inside the plugin itself: no.

In the local Kubernetes deployment: yes, but it is an init container, not a sidecar.

In `../grafana-local`, the local Grafana deployment uses `extraInitContainers` that:

- copy plugin files into the Grafana plugins directory,
- seed example templates into the PVC if the storage is empty.

This is a one-time step during pod startup.

So the short version is:

- no long-running sidecar next to Grafana,
- yes init container in the local Minikube deployment.

Details are in:

- `../grafana-local/values/private-marketplace.yaml`
- `Dockerfile`

## How the local deployment maps storage

In `grafana-local`, plugin storage is backed by a PVC:

- PVC -> volume `marketplace-templates`
- volume -> mount:

```text
/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates
```

That allows templates to survive pod restarts.

## Repository structure

```text
src/        Grafana plugin frontend
pkg/        Go backend built on grafana-plugin-sdk-go
templates/  example template bundles for testing
.config/    webpack configuration
Dockerfile  artifact image for Grafana deployments
Makefile    build, test, and image commands for the plugin
```

## Key files

- Frontend entry: `src/module.ts`
- App root: `src/App.tsx`
- Plugin metadata: `src/plugin.json`
- Upload wizard: `src/components/UploadWizard.tsx`
- Import modal: `src/components/ImportModal.tsx`
- Backend entry: `pkg/main.go`
- Resource handlers: `pkg/plugin/resources.go`
- Storage interface: `pkg/plugin/storage/storage.go`
- Local storage implementation: `pkg/plugin/storage/local.go`

## Build, test, and package

```bash
npm install
npm run build
npm run package
npm run test
npm run typecheck
go test ./pkg/...
make build
make image
```

`npm run package` or `make package` builds a release archive under:

```text
.artifacts/releases/greg00r-templatehub-app-<version>.zip
```

That zip contains a ready-to-unpack `greg00r-templatehub-app/` directory that can be extracted directly into:

```text
/var/lib/grafana/plugins
```

The archive contains:

- the frontend bundle,
- `plugin.json`,
- plugin assets,
- backend binaries for `linux/amd64` and `linux/arm64`.

The repository also includes a GitHub Actions workflow:

- file: `.github/workflows/release-package.yml`
- release trigger: push a tag matching `v*`, for example `v1.0.4`

When a tag is pushed, the workflow:

- runs tests,
- builds the zip archive,
- publishes `.zip` and `.sha256` assets to GitHub Releases.

## Installing from a GitHub Release package

If the release asset already exists on GitHub, deployment to another Grafana instance can look like this:

```bash
curl -L -o template-hub.zip \
  https://github.com/greg00r/greg00r-templatehub-app/releases/download/v1.0.4/greg00r-templatehub-app-1.0.4.zip

unzip template-hub.zip -d /var/lib/grafana/plugins
```

After extraction, the directory should exist at:

```text
/var/lib/grafana/plugins/greg00r-templatehub-app
```

To run the plugin, you also need:

- an allowlist entry for the unsigned plugin:

```text
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=greg00r-templatehub-app
```

- writable storage for templates:

```text
/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates
```

After copying the plugin, restart the Grafana pod or deployment.

In Kubernetes, a typical restart command is:

```bash
kubectl rollout restart deployment/grafana -n monitoring
```

If you use Enterprise RBAC for app plugins, the deployment model stays the same. The difference is only in the Grafana Enterprise configuration. On OSS, the plugin still works with the `Viewer / Editor / Admin` fallback model.

`make image` builds the plugin artifact image. In the local `grafana-local` setup, that deployment uses a unique tag on every rollout to avoid stale init container cache.

## Local deployment

The local Grafana deployment is not maintained in this repository. Use:

```bash
cd ../grafana-local
bash scripts/deploy-private-marketplace.sh
```

## Short answer: do we need a sidecar?

No, not for the plugin itself.

You only need:

- the plugin frontend,
- the plugin backend,
- storage for template files.

In local development, there is an additional init container, but only to:

- copy the plugin into Grafana,
- copy seed templates.
