import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Field, Input, LoadingBar, Select, Stack, Text } from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { getFolders, importDashboard } from '../api/grafana';
import { getTemplateJson } from '../api/templates';
import { DatasourceMapper } from './DatasourceMapper';
import { SimpleModal } from './SimpleModal';
import { VariableField } from './VariableField';
import type {
  DatasourceMapping,
  GrafanaDashboard,
  GrafanaFolder,
  TemplateMetadata,
  TemplateVariable,
} from '../types';
import { navigateToPath } from '../utils/navigation';

interface Props {
  templateId: string;
  metadata: TemplateMetadata;
  variables: TemplateVariable[];
  onDismiss: () => void;
}

type Step = 'variables' | 'datasources' | 'importing';

export function ImportModal({ templateId, metadata, variables, onDismiss }: Props) {
  const appEvents = getAppEvents();

  const [dashboardName, setDashboardName] = useState(metadata.title);
  const [folderUid, setFolderUid] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(variables.map((variable) => [variable.name, variable.default ?? (variable.multi ? [] : '')]))
  );
  const [datasourceMappings, setDatasourceMappings] = useState<DatasourceMapping[]>([]);

  const [folders, setFolders] = useState<GrafanaFolder[]>([]);
  const [dashboard, setDashboard] = useState<GrafanaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('variables');
  const [importing, setImporting] = useState(false);

  const folderOptions = useMemo(
    () => [{ label: 'General', value: '' }, ...folders.map((folder) => ({ label: folder.title, value: folder.uid }))],
    [folders]
  );

  const loadModalData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [templateDashboard, availableFolders] = await Promise.all([
        getTemplateJson(templateId),
        getFolders(),
      ]);

      setDashboard(templateDashboard);
      setFolders(availableFolders);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load template data');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    loadModalData();
  }, [loadModalData]);

  const hasAllRequiredValues = variables
    .filter((variable) => variable.required)
    .every((variable) => {
      const currentValue = variableValues[variable.name];
      return Array.isArray(currentValue) ? currentValue.length > 0 : Boolean(currentValue);
    });

  const handleImport = async () => {
    if (!dashboard) {
      return;
    }

    setImporting(true);
    setStep('importing');
    setError(null);

    try {
      const result = await importDashboard(
        dashboard,
        {
          dashboardName,
          folderUid,
          variables: variableValues,
          datasourceMappings,
        },
        variables
      );

      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Dashboard "${dashboardName}" imported successfully.`],
      });

      onDismiss();
      navigateToPath(result.url);
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : 'Import failed';
      setError(message);
      setStep('datasources');

      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Import failed', message],
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <SimpleModal title={`Import: ${metadata.title}`} onDismiss={onDismiss}>
      {loading && (
        <Stack direction="column" gap={1}>
          <LoadingBar width={320} />
          <Text color="secondary">Loading template data...</Text>
        </Stack>
      )}

      {!loading && error && (
        <Alert title="Error" severity="error" style={{ marginBottom: '16px' }}>
          {error}
        </Alert>
      )}

      {!loading && !error && step === 'variables' && (
        <Stack direction="column" gap={2}>
          <Field label="Dashboard name" required>
            <Input value={dashboardName} onChange={(event) => setDashboardName(event.currentTarget.value)} />
          </Field>

          <Field label="Folder">
            <Select
              options={folderOptions}
              value={folderOptions.find((option) => option.value === folderUid)}
              onChange={(item) => setFolderUid(String(item.value ?? ''))}
            />
          </Field>

          {variables.length > 0 && (
            <>
              <Text variant="h5">Template Variables</Text>
              {variables.map((variable) => (
                <VariableField
                  key={variable.name}
                  variable={variable}
                  value={variableValues[variable.name] ?? variable.default ?? ''}
                  onChange={(nextValue) =>
                    setVariableValues((current) => ({ ...current, [variable.name]: nextValue }))
                  }
                />
              ))}
            </>
          )}

          <Stack justifyContent="flex-end" gap={2}>
            <Button variant="secondary" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => setStep('datasources')}
              disabled={!dashboardName || !hasAllRequiredValues}
            >
              Next: Datasources
            </Button>
          </Stack>
        </Stack>
      )}

      {!loading && !error && step === 'datasources' && dashboard && (
        <Stack direction="column" gap={2}>
          <DatasourceMapper
            dashboard={dashboard}
            mappings={datasourceMappings}
            onChange={setDatasourceMappings}
          />

          <Stack justifyContent="flex-end" gap={2}>
            <Button variant="secondary" onClick={() => setStep('variables')}>
              Back
            </Button>
            <Button variant="primary" icon="import" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : 'Import dashboard'}
            </Button>
          </Stack>
        </Stack>
      )}

      {step === 'importing' && (
        <div style={{ padding: '24px 0' }}>
          <Stack direction="column" gap={1} alignItems="center">
          <LoadingBar width={320} />
          <Text color="secondary">Importing dashboard...</Text>
          </Stack>
        </div>
      )}
    </SimpleModal>
  );
}
