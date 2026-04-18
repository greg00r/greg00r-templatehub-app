import type { GrafanaDashboard, RequiredDatasource, TemplateVariable } from '../types';

export function detectRequiredDatasources(dashboard: GrafanaDashboard): RequiredDatasource[] {
  const discovered = new Map<string, string>();

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    const record = node as Record<string, unknown>;
    const datasource = record.datasource;
    if (datasource && typeof datasource === 'object') {
      const typedDatasource = datasource as { type?: string };
      if (typedDatasource.type && typedDatasource.type !== '-- Grafana --') {
        discovered.set(typedDatasource.type, typedDatasource.type);
      }
    }

    Object.values(record).forEach(walk);
  };

  walk(dashboard);
  return Array.from(discovered.keys()).map((type) => ({ type, name: type }));
}

export function extractTemplateVariablesFromDashboard(dashboard: GrafanaDashboard): TemplateVariable[] {
  return (dashboard.templating?.list ?? []).map((variable) => ({
    name: String(variable.name),
    label: String(variable.label || variable.name),
    type: (variable.type as TemplateVariable['type']) ?? 'textbox',
    description: '',
    default:
      typeof variable.current?.value === 'string'
        ? variable.current.value
        : Array.isArray(variable.current?.value)
          ? variable.current.value[0]
          : '',
    required: false,
    options:
      variable.type === 'custom'
        ? (variable.options ?? []).map((option: { value: string }) => option.value)
        : undefined,
    datasource:
      typeof variable.datasource === 'string'
        ? variable.datasource
        : (variable.datasource as { uid?: string; type?: string } | undefined)?.uid,
    datasourceType:
      typeof variable.datasource === 'object'
        ? (variable.datasource as { type?: string }).type
        : undefined,
    query: typeof variable.query === 'string' ? variable.query : '',
    multi: Boolean(variable.multi),
    includeAll: Boolean(variable.includeAll),
  }));
}
