import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, LoadingBar, Stack, Tag, Text, useStyles2 } from '@grafana/ui';
import { checkDatasourceAvailability } from '../api/grafana';
import { getTemplateImageUrl, getTemplateMetadata, getTemplateVariables } from '../api/templates';
import { ImportModal } from '../components/ImportModal';
import { MarkdownContent } from '../components/MarkdownContent';
import type { TemplateMetadata, TemplateVariables } from '../types';
import { buildPluginPath, navigateToPath } from '../utils/navigation';

interface Props {
  templateId?: string;
}

export function TemplateDetail({ templateId }: Props) {
  const styles = useStyles2(getStyles);

  const [metadata, setMetadata] = useState<TemplateMetadata | null>(null);
  const [variables, setVariables] = useState<TemplateVariables | null>(null);
  const [datasourceAvailability, setDatasourceAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const loadTemplate = useCallback(async () => {
    if (!templateId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [templateMetadata, templateVariables] = await Promise.all([
        getTemplateMetadata(templateId),
        getTemplateVariables(templateId),
      ]);

      setMetadata(templateMetadata);
      setVariables(templateVariables);

      const requiredTypes = templateMetadata.requiredDatasources?.map((item) => item.type) ?? [];
      if (requiredTypes.length > 0) {
        setDatasourceAvailability(await checkDatasourceAvailability(requiredTypes));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load template details');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  if (loading) {
    return (
      <div style={{ padding: '24px' }}>
        <LoadingBar width={320} />
      </div>
    );
  }

  if (error || !metadata) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert title="Failed to load template" severity="error">
          {error ?? 'Unknown error'}
        </Alert>
        <Button
          variant="secondary"
          onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}
          style={{ marginTop: '16px' }}
        >
          Back to gallery
        </Button>
      </div>
    );
  }

  const allRequiredDatasourcesAvailable =
    (metadata.requiredDatasources ?? []).length === 0 ||
    metadata.requiredDatasources.every((datasource) => datasourceAvailability[datasource.type] !== false);

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>
      <Button
        variant="secondary"
        size="sm"
        fill="text"
        onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}
      >
        Back to gallery
      </Button>

      <div style={{ marginTop: '12px' }}>
        <Stack justifyContent="space-between" alignItems="flex-start" wrap="wrap" gap={2}>
          <Stack direction="column" gap={0.5}>
            <Text element="h1" variant="h2">
              {metadata.title}
            </Text>
            <Stack gap={1} wrap="wrap">
              <Text color="secondary">by {metadata.author}</Text>
              <Text color="secondary">version {metadata.version}</Text>
              <Text color="secondary">updated {metadata.updatedAt}</Text>
            </Stack>
          </Stack>

          <Button icon="import" variant="primary" onClick={() => setShowImportModal(true)}>
            Import template
          </Button>
        </Stack>
      </div>

      {metadata.tags?.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <Stack gap={1} wrap="wrap">
            {metadata.tags.map((tag) => (
              <Tag key={tag} name={tag} />
            ))}
          </Stack>
        </div>
      )}

      <div className={styles.contentGrid}>
        <div className={styles.sidebar}>
          {templateId && (
            <img
              src={getTemplateImageUrl(templateId)}
              alt={`${metadata.title} preview`}
              className={styles.previewImage}
              onError={(event) => {
                (event.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}

          {metadata.requiredDatasources?.length > 0 && (
            <div className={styles.infoBox}>
              <Text variant="h5">Required Datasources</Text>
              <div style={{ marginTop: '8px' }}>
                <Stack direction="column" gap={1}>
                  {metadata.requiredDatasources.map((datasource) => {
                    const available = datasourceAvailability[datasource.type];
                    return (
                      <Stack key={`${datasource.type}-${datasource.name}`} justifyContent="space-between" alignItems="center">
                        <Stack gap={1} alignItems="center">
                          <Text>{datasource.name}</Text>
                        <Text color="secondary" variant="bodySmall">
                          ({datasource.type})
                        </Text>
                      </Stack>
                      <span
                        className={available ? styles.statusAvailable : styles.statusMissing}
                      >
                        {available ? 'Available' : 'Missing'}
                      </span>
                    </Stack>
                  );
                })}
                </Stack>
              </div>

              {!allRequiredDatasourcesAvailable && (
                <Alert title="Some datasources are missing" severity="warning" style={{ marginTop: '12px' }}>
                  You can still import the dashboard, but datasource mapping will need attention.
                </Alert>
              )}
            </div>
          )}

          {variables?.variables?.length ? (
            <div className={styles.infoBox}>
              <Text variant="h5">Variables ({variables.variables.length})</Text>
              <div style={{ marginTop: '8px' }}>
                <Stack direction="column" gap={1}>
                  {variables.variables.map((variable) => (
                    <div key={variable.name}>
                      <Text variant="bodySmall">
                        <strong>{variable.label || variable.name}</strong>
                        {variable.required ? ' *' : ''}
                      </Text>
                      {variable.description && (
                        <Text variant="bodySmall" color="secondary">
                          {variable.description}
                        </Text>
                      )}
                    </div>
                  ))}
                </Stack>
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.mainContent}>
          <Text variant="h4">Description</Text>
          <MarkdownContent
            className={styles.markdown}
            content={metadata.longDescription || metadata.shortDescription}
          />
        </div>
      </div>

      {showImportModal && templateId && variables && (
        <ImportModal
          templateId={templateId}
          metadata={metadata}
          variables={variables.variables}
          onDismiss={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    contentGrid: css({
      display: 'grid',
      gridTemplateColumns: '320px 1fr',
      gap: theme.spacing(3),
      marginTop: theme.spacing(3),
      [theme.breakpoints.down('md')]: {
        gridTemplateColumns: '1fr',
      },
    }),
    sidebar: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    previewImage: css({
      width: '100%',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      objectFit: 'cover',
    }),
    infoBox: css({
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    statusPill: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '84px',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: '999px',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      border: `1px solid transparent`,
    }),
    statusAvailable: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '84px',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: '999px',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.success.text,
      background: theme.colors.success.transparent,
      border: `1px solid ${theme.colors.success.border}`,
    }),
    statusMissing: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '84px',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: '999px',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.error.text,
      background: theme.colors.error.transparent,
      border: `1px solid ${theme.colors.error.border}`,
    }),
    mainContent: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    markdown: css({
      p: {
        color: theme.colors.text.secondary,
        lineHeight: 1.6,
      },
      'ul, ol': {
        color: theme.colors.text.secondary,
        paddingLeft: theme.spacing(3),
      },
      code: {
        background: theme.colors.background.secondary,
        borderRadius: theme.shape.radius.default,
        padding: `2px ${theme.spacing(0.5)}`,
      },
    }),
  };
}
