# Private Marketplace Templates

Repozytorium zawiera kod pluginu Grafany `gregoor-private-marketplace-app`.

To jest app plugin z:
- frontendem React/TypeScript,
- backendem Go opartym o `grafana-plugin-sdk-go`,
- lokalnym storage dla template'ow dashboardow,
- flow importu i uploadu z poziomu UI.

Repo nie trzyma chartu Helm ani lokalnego deployu Minikube. To siedzi w sasiednim repo `../grafana-local`.

## Co robi plugin

Plugin rozwiazuje problem prywatnego marketplace'u dashboard templates wewnatrz instancji Grafany:

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
- pobiera template'y z `/api/plugins/gregoor-private-marketplace-app/resources/*`,
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
/var/lib/grafana/plugins-data/gregoor-private-marketplace-app/templates
```

To jest ustawione w backendzie pluginu jako:

- [models.go](C:/Users/gr3g0/Documents/repo/github/private-marketplace-templates/pkg/plugin/models.go)
- `DefaultLocalPath = "/var/lib/grafana/plugins-data/gregoor-private-marketplace-app/templates"`

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

## Co dzieje sie przy uploadzie

Upload to polaczenie frontendu i backendu pluginu:

1. frontend zbiera dashboard JSON, metadata, variables i opcjonalny obraz,
2. frontend wysyla payload do:

```text
/api/plugins/gregoor-private-marketplace-app/resources/templates
```

3. backend pluginu waliduje dane,
4. backend zapisuje bundle do storage,
5. nowy template pojawia sie w galerii.

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
/var/lib/grafana/plugins-data/gregoor-private-marketplace-app/templates
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
npm run test
npm run typecheck
go test ./pkg/...
make build
make image
```

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
