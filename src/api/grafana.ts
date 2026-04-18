import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import { v4 as uuidv4 } from 'uuid';
import type {
  DatasourceMapping,
  GrafanaDashboard,
  GrafanaDataSource,
  GrafanaFolder,
  GrafanaVariable,
  ImportFormValues,
  TemplateVariable,
} from '../types';

export async function getFolders(): Promise<GrafanaFolder[]> {
  return getBackendSrv().get<GrafanaFolder[]>('/api/folders?limit=1000');
}

export async function getDataSources(): Promise<GrafanaDataSource[]> {
  return getBackendSrv().get<GrafanaDataSource[]>('/api/datasources');
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
  templateVariables: TemplateVariable[]
): Promise<{ uid: string; url: string }> {
  const clonedDashboard: GrafanaDashboard = JSON.parse(JSON.stringify(dashboard));

  clonedDashboard.id = null;
  clonedDashboard.uid = uuidv4().replace(/-/g, '').slice(0, 12);
  clonedDashboard.title = formValues.dashboardName;

  ensureTemplatingSection(clonedDashboard);
  upsertTemplateVariables(clonedDashboard, formValues.variables, templateVariables);
  applyDatasourceMappings(clonedDashboard, formValues.datasourceMappings);

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
  if (typeof datasourceValue === 'string') {
    const mapping = mappings.find((item) => item.templateUid === datasourceValue);
    return mapping ? mapping.localUid : datasourceValue;
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
    return datasourceValue;
  }

  const mapping = mappings.find((item) => item.templateUid === currentIdentifier);
  if (!mapping) {
    return datasourceValue;
  }

  datasource.uid = mapping.localUid;
  return datasource;
}

export interface DashboardSearchResult {
  id: number;
  uid: string;
  title: string;
  folderTitle?: string;
}

export async function searchDashboards(query: string): Promise<DashboardSearchResult[]> {
  return getBackendSrv().get<DashboardSearchResult[]>(
    `/api/search?query=${encodeURIComponent(query)}&type=dash-db&limit=20`
  );
}

export async function getDashboardByUid(uid: string): Promise<{ dashboard: GrafanaDashboard }> {
  return getBackendSrv().get<{ dashboard: GrafanaDashboard }>(`/api/dashboards/uid/${uid}`);
}
