# Template Hub

Repozytorium zawiera kod pluginu Grafany `greg00r-templatehub-app` o nazwie `Template Hub`.

To jest app plugin z:
- frontendem React/TypeScript,
- backendem Go opartym o `grafana-plugin-sdk-go`,
- lokalnym storage dla template'ow dashboardow,
- flow importu i uploadu z poziomu UI.

Repo nie trzyma chartu Helm ani lokalnego deployu Minikube. To siedzi w sasiednim repo `../grafana-local`.

## Co robi plugin

Plugin rozwiazuje problem wewnetrznego huba template'ow dashboardow wewnatrz instancji Grafany:

- pokazuje galerie template'ow,
- pozwala wejsc w widok szczegolowy template'u,
- importuje template jako nowy dashboard do wybranego folderu,
- pyta o zmienne przed importem,
- pozwala opublikowac nowy template z poziomu UI,
- zapisuje template lokalnie albo przez interfejs storage moze byc podpiety do zewnetrznego backendu.

## Jak to dziala

Sa tu 3 warstwy:

1. Frontend pluginu
- renderuje galerie, detail, import i upload wizard,
- pobiera template'y z `/api/plugins/greg00r-templatehub-app/resources/*`,
- przy imporcie wywoluje natywne API Grafany `POST /api/dashboards/db`.

2. Backend pluginu
- jest uruchamiany przez Grafane jako backend app pluginu,
- obsluguje resource endpointy pluginu,
- czyta i zapisuje template bundles w storage,
- nie potrzebuje osobnego serwisu HTTP w local mode.

3. Storage
- local mode: pliki na filesystemie Grafany,
- external mode: interfejs jest przygotowany, ale w tym repo to nadal stub / szkic integracji.

## Gdzie zapisuja sie template'y

Domyslna lokalna sciezka pluginu:

```text
/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates
```

To jest ustawione w backendzie pluginu jako:

- [models.go](C:/Users/gr3g0/Documents/repo/github/private-marketplace-templates/pkg/plugin/models.go)
- `DefaultLocalPath = "/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates"`

Plugin ma tez kompatybilnosc wstecz:
- jesli znajdzie stare dane pod `/var/lib/grafana/plugins-data/gregoor-private-marketplace-app/templates`,
- sprobuje je automatycznie przeniesc do nowej sciezki `Template Hub`.

Kazdy template to osobny katalog:

```text
<templates_root>/
  <template_id>/
    template.json
    metadata.json
    variables.json
    image.png / image.jpg / image.webp / ...
```

Przy uploadzie plugin zapisuje:
- `template.json` - dashboard JSON,
- `metadata.json` - tytul, opis, tagi, wymagane datasources itd.,
- `variables.json` - definicje pol formularza importu,
- `image.*` - obraz podgladu, jesli zostal dodany.

## Co dzieje sie przy imporcie

Import to glownie praca frontendu pluginu plus natywnego API Grafany:

1. frontend pobiera `template.json`, `metadata.json` i `variables.json`,
2. uzytkownik uzupelnia zmienne i wybiera folder,
3. frontend przygotowuje dashboard do importu,
4. frontend wysyla gotowy dashboard do Grafany przez `POST /api/dashboards/db`.

Wazne:
- backend pluginu nie tworzy dashboardu bezposrednio w bazie Grafany,
- backend pluginu tylko dostarcza i zapisuje template bundles,
- sam import dashboardu korzysta z oficjalnego API Grafany.
- plugin wystawia import dla wszystkich uzytkownikow, ktorzy maja dostep do aplikacji, ale finalny zapis dashboardu nadal respektuje uprawnienia Grafany do tworzenia dashboardow i zapisu do folderu.

## Co dzieje sie przy uploadzie

Upload to polaczenie frontendu i backendu pluginu:

1. frontend zbiera dashboard JSON, metadata, variables i opcjonalny obraz,
2. frontend wysyla payload do:

```text
/api/plugins/greg00r-templatehub-app/resources/templates
```

3. backend pluginu waliduje dane,
4. backend zapisuje bundle do storage,
5. nowy template pojawia sie w galerii.

Upload jest ograniczony do rol `Editor` i `Admin`:
- frontend ukrywa akcje publikacji dla `Viewer`,
- strona `/upload` pokazuje guard w UI,
- backend pluginu dodatkowo egzekwuje to po stronie serwera, wiec sam frontend nie jest jedyna ochrona.

## Czy to jest tylko praca pluginu

Z punktu widzenia runtime: tak.

W normalnym dzialaniu nie ma tu sidecara ani osobnego backend service.

Runtime sklada sie z:
- frontend bundle pluginu ladowanego w przegladarce,
- backend binary pluginu uruchamianego przez Grafane,
- lokalnego katalogu na pliki template'ow.

Czyli:
- brak sidecara do obslugi requestow pluginu,
- brak osobnego kontenera API dla local mode,
- brak osobnej bazy danych dla pluginu.

## Czy jest tu jakis dodatkowy kontener

W samym pluginie: nie.

W lokalnym deployu Kubernetes: tak, ale to nie jest sidecar, tylko init container.

W repo `../grafana-local` lokalna Grafana uzywa `extraInitContainers`, ktore:
- kopiuja pliki pluginu do katalogu pluginow Grafany,
- seeduja przykladowe template'y do PVC, jesli storage jest pusty.

To jest jednorazowy krok przed startem poda Grafany.

Czyli:
- `nie`: sidecar dzialajacy razem z Grafana przez caly czas,
- `tak`: init container przy starcie poda w lokalnym deployu Minikube.

Szczegoly sa w:
- [../grafana-local/values/private-marketplace.yaml](C:/Users/gr3g0/Documents/repo/github/grafana-local/values/private-marketplace.yaml)
- [Dockerfile](C:/Users/gr3g0/Documents/repo/github/private-marketplace-templates/Dockerfile)

## Jak lokalny deploy mapuje storage

W `grafana-local` storage pluginu jest podmontowany z PVC:

- PVC -> volume `marketplace-templates`
- volume -> mount:

```text
/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates
```

Dzieki temu template'y przetrwaja restart poda.

## Struktura repo

```text
src/        frontend pluginu Grafany
pkg/        backend Go oparty o grafana-plugin-sdk-go
templates/  przykladowe template bundles do testow
.config/    konfiguracja webpacka
Dockerfile  obraz artefaktu pluginu dla Grafany
Makefile    build/test/image dla samego pluginu
```

## Najwazniejsze pliki

- Frontend entry: `src/module.ts`
- App root: `src/App.tsx`
- Plugin metadata: `src/plugin.json`
- Upload wizard: `src/components/UploadWizard.tsx`
- Import modal: `src/components/ImportModal.tsx`
- Backend entry: `pkg/main.go`
- Resource handlers: `pkg/plugin/resources.go`
- Storage interface: `pkg/plugin/storage/storage.go`
- Local storage: `pkg/plugin/storage/local.go`

## Build i testy

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

`npm run package` albo `make package` buduje gotowa paczke release do katalogu:

```text
.artifacts/releases/greg00r-templatehub-app-<version>.zip
```

To jest zip z katalogiem `greg00r-templatehub-app/`, ktory mozna wypakowac bezposrednio do:

```text
/var/lib/grafana/plugins
```

W srodku sa:
- frontend bundle,
- `plugin.json`,
- assety pluginu,
- backend binaries dla `linux/amd64` i `linux/arm64`.

Repo ma tez workflow GitHub Actions:

- plik: `.github/workflows/release-package.yml`
- trigger release: push taga `v*`, np. `v1.0.4`

Po pushu taga workflow:
- uruchamia testy,
- buduje zip,
- publikuje assety `.zip` i `.sha256` do GitHub Release.

## Instalacja z gotowej paczki GitHub Release

Jesli release asset jest juz zbudowany na GitHubie, wdrozenie do innej Grafany moze wygladac tak:

```bash
curl -L -o template-hub.zip \
  https://github.com/greg00r/greg00r-templatehub-app/releases/download/v1.0.4/greg00r-templatehub-app-1.0.4.zip

unzip template-hub.zip -d /var/lib/grafana/plugins
```

Po rozpakowaniu powinienes miec katalog:

```text
/var/lib/grafana/plugins/greg00r-templatehub-app
```

Do uruchomienia pluginu potrzebujesz jeszcze:

- allowlisty dla unsigned plugin:

```text
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=greg00r-templatehub-app
```

- writable storage dla template'ow:

```text
/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates
```

Po skopiowaniu pluginu zrestartuj Pode/Deploy Grafany.

W Kubernetes zwykle wystarczy:

```bash
kubectl rollout restart deployment/grafana -n monitoring
```

Jesli uzywasz Enterprise RBAC dla app pluginow, sam deploy jest taki sam. Roznica jest tylko po stronie konfiguracji Grafany Enterprise. Na OSS plugin nadal dziala z fallbackiem do `Viewer / Editor / Admin`.

`make image` buduje obraz artefaktu pluginu. W lokalnym deployu `grafana-local` uzywa unikalnego taga przy kazdym deployu, zeby nie podnosic starego init containera z cache.

## Lokalny deploy

Lokalna Grafana nie jest utrzymywana w tym repo. Uzyj:

```bash
cd ../grafana-local
bash scripts/deploy-private-marketplace.sh
```

## Krotka odpowiedz na pytanie "czy potrzebujemy side containera?"

Nie do samego dzialania pluginu.

Potrzebujesz tylko:
- plugin frontend,
- plugin backend,
- storage na pliki.

W naszym local dev deployu jest dodatkowy init container, ale tylko po to, zeby:
- wrzucic plugin do Grafany,
- skopiowac seed templates.
