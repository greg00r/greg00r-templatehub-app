import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Field, Select, Stack, Text } from '@grafana/ui';
import { getDataSources } from '../api/grafana';
import type { DatasourceMapping, GrafanaDashboard, GrafanaDataSource } from '../types';

interface Props {
  dashboard: GrafanaDashboard;
  mappings: DatasourceMapping[];
  onChange: (mappings: DatasourceMapping[]) => void;
}

interface TemplateDatasourceRef {
  id: string;
  type: string;
}

export function DatasourceMapper({ dashboard, mappings, onChange }: Props) {
  const [localDatasources, setLocalDatasources] = useState<GrafanaDataSource[]>([]);

  useEffect(() => {
    getDataSources().then(setLocalDatasources).catch(() => setLocalDatasources([]));
  }, []);

  const templateDatasourceRefs = useMemo(
    () => extractDatasourceRefs(dashboard),
    [dashboard]
  );

  useEffect(() => {
    const existingTemplateIds = new Set(mappings.map((mapping) => mapping.templateUid));
    const inferredMappings = templateDatasourceRefs
      .filter((ref) => !existingTemplateIds.has(ref.id))
      .map((ref) => {
        const suggestedDatasource = localDatasources.find((datasource) => datasource.type === ref.type);

        return {
          templateUid: ref.id,
          templateType: ref.type,
          localUid: suggestedDatasource?.uid ?? '',
        };
      });

    if (inferredMappings.length > 0) {
      onChange([...mappings, ...inferredMappings]);
    }
  }, [localDatasources, mappings, onChange, templateDatasourceRefs]);

  if (templateDatasourceRefs.length === 0) {
    return (
      <Alert title="No datasource mapping needed" severity="info">
        This dashboard does not contain datasource UIDs or datasource placeholders.
      </Alert>
    );
  }

  return (
    <Stack direction="column" gap={2}>
      <Text color="secondary">
        Map datasource placeholders or UIDs from the template to datasources available in this Grafana instance.
      </Text>

      {templateDatasourceRefs.map((ref) => {
        const mapping = mappings.find((item) => item.templateUid === ref.id);
        const options = localDatasources
          .filter((datasource) => !ref.type || datasource.type === ref.type)
          .map((datasource) => ({
            label: `${datasource.name} (${datasource.type})`,
            value: datasource.uid,
          }));

        const selectedOption = options.find((option) => option.value === mapping?.localUid);

        return (
          <Field
            key={ref.id}
            label={ref.id}
            description={ref.type ? `Expected type: ${ref.type}` : undefined}
          >
            <Select
              options={options}
              value={selectedOption}
              onChange={(item) => {
                const localUid = String(item.value ?? '');
                onChange(
                  mappings.map((current) =>
                    current.templateUid === ref.id ? { ...current, localUid } : current
                  )
                );
              }}
              placeholder="Select local datasource"
              isClearable
            />
          </Field>
        );
      })}
    </Stack>
  );
}

function extractDatasourceRefs(node: unknown, seen = new Map<string, string>()): TemplateDatasourceRef[] {
  if (Array.isArray(node)) {
    node.forEach((item) => extractDatasourceRefs(item, seen));
    return Array.from(seen.entries()).map(([id, type]) => ({ id, type }));
  }

  if (!node || typeof node !== 'object') {
    return Array.from(seen.entries()).map(([id, type]) => ({ id, type }));
  }

  const record = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (key !== 'datasource') {
      extractDatasourceRefs(value, seen);
      continue;
    }

    if (typeof value === 'string') {
      seen.set(value, seen.get(value) ?? '');
      continue;
    }

    if (!value || typeof value !== 'object') {
      continue;
    }

    const datasource = value as { uid?: string; type?: string; name?: string };
    const identifier = datasource.uid || datasource.name;
    if (identifier && identifier !== '-- Grafana --') {
      seen.set(identifier, datasource.type ?? seen.get(identifier) ?? '');
    }
  }

  return Array.from(seen.entries()).map(([id, type]) => ({ id, type }));
}
