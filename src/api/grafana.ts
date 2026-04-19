import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import { v4 as uuidv4 } from 'uuid';
import type {
  DatasourceMapping,
  GrafanaDashboard,
  GrafanaDataSource,
  GrafanaDatasourcePlugin,
  GrafanaFolder,
  GrafanaVariable,
  ImportFormValues,
  TemplateMetadata,
  TemplateVariable,
} from '../types';

export async function getFolders(): Promise<GrafanaFolder[]> {
  const [apiFolders, searchFolders] = await Promise.all([
    getBackendSrv()
      .get<GrafanaFolder[]>('/api/folders?limit=1000')
      .catch(() => [] as GrafanaFolder[]),
    getBackendSrv()
      .get<Array<Partial<GrafanaFolder>>>('/api/search?type=dash-folder&limit=1000')
      .catch(() => [] as Array<Partial<GrafanaFolder>>),
  ]);

  return normalizeGrafanaFolders([...apiFolders, ...searchFolders]);
}

export async function getDataSources(): Promise<GrafanaDataSource[]> {
  const runtimeDataSources = normalizeGrafanaDataSources(getDataSourceSrv().getList());
  const apiDataSources = await getBackendSrv()
    .get<GrafanaDataSource[]>('/api/datasources')
    .catch(() => [] as GrafanaDataSource[]);

  return normalizeGrafanaDataSources([...runtimeDataSources, ...apiDataSources]);
}

export async function getAvailableDatasourceTypes(): Promise<GrafanaDatasourcePlugin[]> {
  const plugins = await getBackendSrv().get<Array<Partial<GrafanaDatasourcePlugin>>>('/api/plugins?type=datasource');

  const deduped = new Map<string, GrafanaDatasourcePlugin>();
  for (const plugin of plugins) {
    const id = typeof plugin.id === 'string' ? plugin.id.trim() : '';
    const name = typeof plugin.name === 'string' ? plugin.name.trim() : '';
    const type = plugin.type;

    if (!id || !name || type !== 'datasource') {
      continue;
    }

    deduped.set(id, {
      id,
      name,
      type,
    });
  }

  return Array.from(deduped.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export async function checkDatasourceAvailability(
  requiredTypes: string[]
): Promise<Record<string, boolean>> {
  const datasources = await getDataSources();
  const availableTypes = new Set(datasources.map((ds) => ds.type.toLowerCase()));

  return requiredTypes.reduce<Record<string, boolean>>((acc, type) => {
    acc[type] = availableTypes.has(type.toLowerCase());
    return acc;
  }, {});
}

export async function resolveDatasourceQueryOptions(
  datasourceRef: string,
  query: string
): Promise<string[]> {
  const candidates = await resolveDatasourceLookupCandidates(datasourceRef);

  for (const candidate of candidates) {
    try {
      const ds = await getDataSourceSrv().get(candidate);
      const result = await ds.metricFindQuery?.(query, {});

      if (Array.isArray(result)) {
        return result
          .map((item) => String(item.text ?? item.value ?? ''))
          .filter(Boolean);
      }
    } catch {
      // Try the next candidate.
    }
  }

  return [];
}

async function resolveDatasourceLookupCandidates(datasourceRef: string): Promise<string[]> {
  if (!datasourceRef) {
    return [];
  }

  const datasources = await getDataSources();
  const normalized = datasourceRef.toLowerCase();
  const matches = datasources.filter(
    (ds) =>
      ds.uid.toLowerCase() === normalized ||
      ds.name.toLowerCase() === normalized ||
      ds.type.toLowerCase() === normalized
  );

  return Array.from(
    new Set([
      datasourceRef,
      ...matches.flatMap((ds) => [ds.uid, ds.name]),
    ].filter(Boolean))
  );
}

export async function importDashboard(
  dashboard: GrafanaDashboard,
  formValues: ImportFormValues,
  templateVariables: TemplateVariable[],
  metadata: Pick<TemplateMetadata, 'tags' | 'requiredDatasources'>
): Promise<{ uid: string; url: string }> {
  const clonedDashboard: GrafanaDashboard = JSON.parse(JSON.stringify(dashboard));

  clonedDashboard.id = null;
  clonedDashboard.uid = uuidv4().replace(/-/g, '').slice(0, 12);
  clonedDashboard.title = formValues.dashboardName;
  clonedDashboard.tags = mergeDashboardTags(clonedDashboard.tags, metadata.tags);

  ensureTemplatingSection(clonedDashboard);
  upsertTemplateVariables(clonedDashboard, formValues.variables, templateVariables);
  applyDatasourceMappings(clonedDashboard, formValues.datasourceMappings);

  if (metadata.tags.length > 0) {
    const labelImportResult = await tryImportDashboardWithLabels(clonedDashboard, formValues);
    if (labelImportResult) {
      return labelImportResult;
    }
  }

  const response = await getBackendSrv().post<{
    id: number;
    uid: string;
    url: string;
    slug: string;
    status: string;
  }>('/api/dashboards/db', {
    dashboard: clonedDashboard,
    folderUid: formValues.folderUid || undefined,
    overwrite: false,
    message: 'Imported from Private Marketplace',
  });

  return { uid: response.uid, url: response.url };
}

function ensureTemplatingSection(dashboard: GrafanaDashboard): void {
  if (!dashboard.templating) {
    dashboard.templating = { list: [] };
  }
}

function upsertTemplateVariables(
  dashboard: GrafanaDashboard,
  values: Record<string, string | string[]>,
  variableDefinitions: TemplateVariable[]
): void {
  const templatingList = dashboard.templating?.list ?? [];

  for (const variableDefinition of variableDefinitions) {
    const value = values[variableDefinition.name];
    if (value === undefined) {
      continue;
    }

    const existing = templatingList.find((item) => item.name === variableDefinition.name);
    const nextVariable = buildGrafanaVariable(variableDefinition, value, existing);

    if (existing) {
      Object.assign(existing, nextVariable);
    } else {
      templatingList.push(nextVariable);
    }
  }
}

function buildGrafanaVariable(
  definition: TemplateVariable,
  value: string | string[],
  existing?: GrafanaVariable
): GrafanaVariable {
  const normalizedArray = Array.isArray(value) ? value : [value];
  const currentValue = Array.isArray(value) ? value : value;
  const currentText = Array.isArray(value) ? normalizedArray.join(', ') : value;

  const base: GrafanaVariable = {
    ...(existing ?? {}),
    name: definition.name,
    label: definition.label || definition.name,
    type: definition.type,
    hide: existing?.hide ?? (definition.type === 'constant' ? 2 : 0),
    current: {
      value: currentValue,
      text: currentText,
    },
  } as GrafanaVariable;

  if (definition.type === 'textbox' || definition.type === 'constant') {
    base.query = Array.isArray(value) ? normalizedArray[0] : value;
  }

  if (definition.type === 'custom') {
    const options = (definition.options ?? normalizedArray).map((option) => ({
      value: option,
      text: option,
      selected: normalizedArray.includes(option),
    }));

    base.options = options;
    base.query = (definition.options ?? normalizedArray).join(',');
    base.multi = Boolean(definition.multi);
    base.includeAll = Boolean(definition.includeAll);
  }

  if (definition.type === 'query') {
    base.query = definition.query ?? existing?.query ?? '';
    base.multi = Boolean(definition.multi);
    base.includeAll = Boolean(definition.includeAll);

    if (definition.datasource) {
      base.datasource =
        typeof existing?.datasource === 'object' && existing.datasource
          ? { ...(existing.datasource as Record<string, unknown>) }
          : definition.datasource;
    }
  }

  if (definition.type === 'datasource') {
    base.query = definition.datasourceType ?? existing?.query ?? '';
    base.regex = existing?.regex ?? '';
  }

  return base;
}

function applyDatasourceMappings(dashboard: unknown, mappings: DatasourceMapping[]): void {
  if (!mappings.length) {
    return;
  }

  walkAndReplaceDatasources(dashboard, mappings);
}

function walkAndReplaceDatasources(node: unknown, mappings: DatasourceMapping[]): void {
  if (Array.isArray(node)) {
    node.forEach((item) => walkAndReplaceDatasources(item, mappings));
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (key !== 'datasource') {
      walkAndReplaceDatasources(value, mappings);
      continue;
    }

    const mappedValue = mapDatasourceValue(value, mappings);
    if (mappedValue !== undefined) {
      record[key] = mappedValue;
    }
  }
}

function mapDatasourceValue(
  datasourceValue: unknown,
  mappings: DatasourceMapping[]
): unknown {
  const explicitMappings = mappings.filter((mapping) => mapping.source === 'reference' || mapping.source === undefined);
  const requiredMappings = mappings.filter((mapping) => mapping.source === 'required');

  if (typeof datasourceValue === 'string') {
    const explicitMapping = explicitMappings.find((item) => item.templateUid === datasourceValue);
    if (explicitMapping) {
      return explicitMapping.localUid;
    }

    const requiredMapping = requiredMappings.find(
      (item) => item.requiredName === datasourceValue || item.templateType === datasourceValue
    );
    return requiredMapping?.localUid || datasourceValue;
  }

  if (!datasourceValue || typeof datasourceValue !== 'object') {
    return datasourceValue;
  }

  const datasource = { ...(datasourceValue as Record<string, unknown>) };
  const currentIdentifier =
    typeof datasource.uid === 'string'
      ? datasource.uid
      : typeof datasource.name === 'string'
        ? datasource.name
        : undefined;

  if (!currentIdentifier) {
    const fallbackMapping = selectRequiredDatasourceMapping(requiredMappings, datasource);
    if (!fallbackMapping) {
      return datasourceValue;
    }

    datasource.uid = fallbackMapping.localUid;
    return datasource;
  }

  const explicitMapping = explicitMappings.find((item) => item.templateUid === currentIdentifier);
  if (explicitMapping) {
    datasource.uid = explicitMapping.localUid;
    return datasource;
  }

  const fallbackMapping = selectRequiredDatasourceMapping(requiredMappings, datasource, currentIdentifier);
  if (!fallbackMapping) {
    return datasourceValue;
  }

  datasource.uid = fallbackMapping.localUid;
  return datasource;
}

function selectRequiredDatasourceMapping(
  mappings: DatasourceMapping[],
  datasource: Record<string, unknown>,
  currentIdentifier?: string
): DatasourceMapping | undefined {
  if (currentIdentifier) {
    const directMatch = mappings.find(
      (item) => item.requiredName === currentIdentifier || item.templateType === currentIdentifier
    );
    if (directMatch) {
      return directMatch;
    }
  }

  const datasourceType = typeof datasource.type === 'string' ? datasource.type : '';
  if (!datasourceType) {
    return undefined;
  }

  const typeMatches = mappings.filter((item) => item.templateType === datasourceType);
  if (typeMatches.length === 1) {
    return typeMatches[0];
  }

  return undefined;
}

function mergeDashboardTags(existingTags: string[] | undefined, templateTags: string[]): string[] {
  const merged = [...(existingTags ?? []), ...templateTags]
    .map((tag) => tag.trim())
    .filter(Boolean);

  return Array.from(new Set(merged));
}

async function tryImportDashboardWithLabels(
  dashboard: GrafanaDashboard,
  formValues: ImportFormValues
): Promise<{ uid: string; url: string } | null> {
  const labels = buildDashboardLabels(dashboard.tags ?? []);
  if (Object.keys(labels).length === 0) {
    return null;
  }

  try {
    const response = await getBackendSrv().post<{
      metadata?: {
        name?: string;
        uid?: string;
      };
      spec?: { uid?: string };
    }>('/apis/dashboard.grafana.app/v1/namespaces/default/dashboards', {
      metadata: {
        generateName: `${slugifyForLabel(formValues.dashboardName) || 'dashboard'}-`,
        annotations: buildDashboardAnnotations(formValues.folderUid),
        labels,
      },
      spec: dashboard,
    });

    const dashboardUid = resolveCreatedDashboardUid(response, dashboard.uid);

    if (!dashboardUid) {
      return null;
    }

    const dashboardUrl = await getCreatedDashboardUrl(dashboardUid);

    return {
      uid: dashboardUid,
      url: dashboardUrl || `/d/${dashboardUid}`,
    };
  } catch {
    // Fall back to the legacy API if the labels-aware dashboard API is unavailable.
    return null;
  }
}

function resolveCreatedDashboardUid(
  response: { metadata?: { name?: string; uid?: string }; spec?: { uid?: string } },
  fallbackUid?: string
): string {
  if (response.metadata?.name?.trim()) {
    return response.metadata.name.trim();
  }

  if (response.spec?.uid?.trim()) {
    return response.spec.uid.trim();
  }

  if (response.metadata?.uid?.trim()) {
    return response.metadata.uid.trim();
  }

  return fallbackUid?.trim() ?? '';
}

async function getCreatedDashboardUrl(dashboardUid: string): Promise<string | null> {
  try {
    const response = await getBackendSrv().get<{ meta?: { url?: string } }>(`/api/dashboards/uid/${dashboardUid}`);
    return response.meta?.url?.trim() || null;
  } catch {
    return null;
  }
}

function buildDashboardAnnotations(folderUid: string): Record<string, string> {
  return {
    ...(folderUid ? { 'grafana.app/folder': folderUid } : {}),
    'grafana.app/message': 'Imported from Private Marketplace',
  };
}

function buildDashboardLabels(tags: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  const seenKeys = new Set<string>();

  for (const tag of tags) {
    const normalizedTag = tag.trim();
    if (!normalizedTag) {
      continue;
    }

    const baseKey = `private-marketplace.grafana.app/tag-${slugifyForLabel(normalizedTag) || 'tag'}`;
    let nextKey = baseKey;
    let suffix = 2;
    while (seenKeys.has(nextKey)) {
      nextKey = `${baseKey}-${suffix}`;
      suffix += 1;
    }

    seenKeys.add(nextKey);
    labels[nextKey] = normalizedTag;
  }

  return labels;
}

function slugifyForLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export interface DashboardSearchResult {
  id: number;
  uid: string;
  title: string;
  folderTitle?: string;
}

export async function searchDashboards(query: string): Promise<DashboardSearchResult[]> {
  const normalizedQuery = query.trim();
  const searchPath = normalizedQuery
    ? `/api/search?query=${encodeURIComponent(normalizedQuery)}&type=dash-db&limit=20`
    : '/api/search?type=dash-db&limit=20';

  const results = await getBackendSrv().get<Array<Partial<DashboardSearchResult>>>(searchPath);
  return normalizeDashboardSearchResults(results);
}

export async function getDashboardByUid(uid: string): Promise<{ dashboard: GrafanaDashboard }> {
  return getBackendSrv().get<{ dashboard: GrafanaDashboard }>(`/api/dashboards/uid/${uid}`);
}

function normalizeGrafanaDataSources(dataSources: Array<Partial<GrafanaDataSource>>): GrafanaDataSource[] {
  const deduped = new Map<string, GrafanaDataSource>();

  for (const dataSource of dataSources) {
    const uid = typeof dataSource.uid === 'string' ? dataSource.uid.trim() : '';
    const name = typeof dataSource.name === 'string' ? dataSource.name.trim() : '';
    const type = typeof dataSource.type === 'string' ? dataSource.type.trim() : '';

    if (!uid || !name || !type) {
      continue;
    }

    deduped.set(uid, {
      id: typeof dataSource.id === 'number' ? dataSource.id : 0,
      uid,
      name,
      type,
      isDefault: Boolean(dataSource.isDefault),
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function normalizeGrafanaFolders(folders: Array<Partial<GrafanaFolder>>): GrafanaFolder[] {
  const deduped = new Map<string, GrafanaFolder>();

  for (const folder of folders) {
    const uid = typeof folder.uid === 'string' ? folder.uid.trim() : '';
    const title = typeof folder.title === 'string' ? folder.title.trim() : '';

    if (!uid || !title) {
      continue;
    }

    deduped.set(uid, {
      id: typeof folder.id === 'number' ? folder.id : 0,
      uid,
      title,
    });
  }

  return Array.from(deduped.values()).sort((left, right) => left.title.localeCompare(right.title));
}

function normalizeDashboardSearchResults(
  results: Array<Partial<DashboardSearchResult>>
): DashboardSearchResult[] {
  const deduped = new Map<string, DashboardSearchResult>();

  for (const result of results) {
    const uid = typeof result.uid === 'string' ? result.uid.trim() : '';
    const title = typeof result.title === 'string' ? result.title.trim() : '';

    if (!uid || !title) {
      continue;
    }

    deduped.set(uid, {
      id: typeof result.id === 'number' ? result.id : 0,
      uid,
      title,
      folderTitle: typeof result.folderTitle === 'string' ? result.folderTitle.trim() || undefined : undefined,
    });
  }

  return Array.from(deduped.values());
}
