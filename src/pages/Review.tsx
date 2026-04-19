import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2 } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { Alert, Button, LoadingBar, Stack, Tag, Text, useStyles2 } from '@grafana/ui';
import { approveTemplate, deleteTemplate, listTemplates } from '../api/templates';
import { useMarketplaceAccess } from '../hooks/useMarketplaceAccess';
import type { Template } from '../types';
import { buildPluginPath, navigateToPath } from '../utils/navigation';
import { getTemplateFolderLabel, getTemplateLastPublisherLabel } from '../utils/templateMetadata';

export function Review() {
  const styles = useStyles2(getStyles);
  const appEvents = getAppEvents();
  const { access, loading: accessLoading } = useMarketplaceAccess();
  const canReviewTemplates = access.review;
  const canApproveTemplates = access.approve;
  const canDeleteTemplates = access.delete;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);

  const loadPendingTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setTemplates(await listTemplates('pending'));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load pending templates';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canReviewTemplates) {
      loadPendingTemplates();
    } else {
      setLoading(false);
    }
  }, [canReviewTemplates, loadPendingTemplates]);

  const handleApprove = async (template: Template) => {
    if (!canApproveTemplates) {
      return;
    }

    setBusyTemplateId(template.metadata.id);

    try {
      await approveTemplate(template.metadata.id);
      setTemplates((current) => current.filter((item) => item.metadata.id !== template.metadata.id));
      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Template "${template.metadata.title}" is now live in Template Hub.`],
      });
    } catch (approveError) {
      const message = approveError instanceof Error ? approveError.message : 'Failed to approve template';
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Approval failed', message],
      });
    } finally {
      setBusyTemplateId(null);
    }
  };

  const handleReject = async (template: Template) => {
    if (!canDeleteTemplates) {
      return;
    }

    setBusyTemplateId(template.metadata.id);

    try {
      await deleteTemplate(template.metadata.id, 'pending');
      setTemplates((current) => current.filter((item) => item.metadata.id !== template.metadata.id));
      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Pending submission "${template.metadata.title}" was removed.`],
      });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Failed to remove template';
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Remove failed', message],
      });
    } finally {
      setBusyTemplateId(null);
    }
  };

  if (accessLoading) {
    return (
      <div className={styles.page}>
        <Button variant="secondary" size="sm" fill="text" onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}>
          Back to gallery
        </Button>
        <LoadingBar width={320} />
      </div>
    );
  }

  if (!canReviewTemplates) {
    return (
      <div className={styles.page}>
        <Button variant="secondary" size="sm" fill="text" onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}>
          Back to gallery
        </Button>
        <Alert title="Review access required" severity="warning">
          You need the Template Hub review permission or the Admin basic role to moderate pending dashboard templates.
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Text element="h1" variant="h2">
            Review Templates
          </Text>
          <Text color="secondary">
            Editor and Admin uploads land in the waiting room first. Approving a submission moves it into live Template Hub.
          </Text>
        </div>

        <Stack gap={1}>
          <Button variant="secondary" onClick={loadPendingTemplates} disabled={loading}>
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}>
            Open gallery
          </Button>
        </Stack>
      </div>

      <div className={styles.summaryBox}>
        <Text variant="h5">Waiting room</Text>
        <Text color="secondary">
          {templates.length} pending submission{templates.length === 1 ? '' : 's'} ready for moderation.
        </Text>
      </div>

      {loading && <LoadingBar width={320} />}

      {!loading && error && (
        <Alert title="Failed to load pending templates" severity="error">
          {error}
        </Alert>
      )}

      {!loading && !error && templates.length === 0 && (
        <div className={styles.emptyState}>
          <Text variant="h5">Nothing is waiting for approval</Text>
          <Text color="secondary">New submissions from Editors and Admins will appear here.</Text>
        </div>
      )}

      {!loading && !error && templates.length > 0 && (
        <div className={styles.grid}>
          {templates.map((template) => {
            const isBusy = busyTemplateId === template.metadata.id;
            const folderLabel = getTemplateFolderLabel(template.metadata);
            const lastPublisher = getTemplateLastPublisherLabel(template.metadata);

            return (
              <div key={template.metadata.id} className={styles.card}>
                {template.imageUrl && (
                  <img
                    src={template.imageUrl}
                    alt={`${template.metadata.title} preview`}
                    className={styles.previewImage}
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}

                <Stack direction="column" gap={1}>
                  <Text variant="h4">{template.metadata.title}</Text>
                  <Text color="secondary">{template.metadata.shortDescription}</Text>
                  <Text variant="bodySmall" color="secondary">
                    Submitted by {template.metadata.author}
                    {template.metadata.createdAt ? ` on ${template.metadata.createdAt}` : ''}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Folder {folderLabel}
                  </Text>
                  {template.metadata.version && (
                    <Text variant="bodySmall" color="secondary">
                      Version {template.metadata.version}
                    </Text>
                  )}
                  <Text variant="bodySmall" color="secondary">
                    Last pushed by {lastPublisher}
                  </Text>
                </Stack>

                {template.metadata.tags?.length > 0 && (
                  <Stack gap={1} wrap="wrap">
                    {template.metadata.tags.map((tag) => (
                      <Tag key={tag} name={tag} />
                    ))}
                  </Stack>
                )}

                {template.metadata.requiredDatasources?.length > 0 && (
                  <div className={styles.infoList}>
                    <Text variant="bodySmall" color="secondary">
                      Required datasources:
                    </Text>
                    <Text variant="bodySmall">
                      {template.metadata.requiredDatasources.map((datasource) => datasource.type).join(', ')}
                    </Text>
                  </div>
                )}

                <div className={styles.actions}>
                  {canDeleteTemplates && (
                    <Button
                      variant="destructive"
                      onClick={() => handleReject(template)}
                      disabled={isBusy}
                    >
                      {isBusy ? 'Working...' : 'Reject'}
                    </Button>
                  )}
                  {canApproveTemplates && (
                    <Button
                      variant="primary"
                      onClick={() => handleApprove(template)}
                      disabled={isBusy}
                    >
                      {isBusy ? 'Working...' : 'Approve'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    page: css({
      padding: theme.spacing(3),
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    header: css({
      display: 'flex',
      justifyContent: 'space-between',
      gap: theme.spacing(2),
      flexWrap: 'wrap',
    }),
    summaryBox: css({
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
    }),
    emptyState: css({
      padding: theme.spacing(3),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: theme.spacing(2),
    }),
    card: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.secondary,
    }),
    previewImage: css({
      width: '100%',
      height: '180px',
      borderRadius: theme.shape.radius.default,
      objectFit: 'cover',
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    infoList: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    actions: css({
      display: 'flex',
      justifyContent: 'flex-end',
      gap: theme.spacing(1),
      marginTop: 'auto',
    }),
  };
}
