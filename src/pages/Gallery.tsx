import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2 } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { deleteTemplate, listTemplates } from '../api/templates';
import { TemplateCard } from '../components/TemplateCard';
import { useMarketplaceAccess } from '../hooks/useMarketplaceAccess';
import type { Template } from '../types';
import { buildPluginPath, navigateToPath } from '../utils/navigation';

export function Gallery() {
  const appEvents = getAppEvents();
  const styles = useStyles2(getStyles);
  const { access } = useMarketplaceAccess();
  const canPublishTemplates = access.publish;
  const canReviewTemplates = access.review;
  const canDeleteTemplates = access.delete;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedDatasourceType, setSelectedDatasourceType] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setTemplates(await listTemplates());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load templates';
      setError(message);
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Failed to load templates', message],
      });
    } finally {
      setLoading(false);
    }
  }, [appEvents]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const allTags = useMemo(() => {
    const uniqueTags = new Set<string>();
    templates.forEach((template) => template.metadata.tags?.forEach((tag) => uniqueTags.add(tag)));
    return Array.from(uniqueTags).sort();
  }, [templates]);

  const allDatasourceTypes = useMemo(() => {
    const uniqueTypes = new Set<string>();
    templates.forEach((template) =>
      template.metadata.requiredDatasources?.forEach((datasource) => uniqueTypes.add(datasource.type))
    );
    return Array.from(uniqueTypes).sort();
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return templates.filter((template) => {
      const searchableText = [
        template.metadata.title,
        template.metadata.shortDescription,
        ...(template.metadata.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();

      if (normalizedQuery && !searchableText.includes(normalizedQuery)) {
        return false;
      }

      if (selectedTag && !template.metadata.tags?.includes(selectedTag)) {
        return false;
      }

      if (
        selectedDatasourceType &&
        !(template.metadata.requiredDatasources ?? []).some((item) => item.type === selectedDatasourceType)
      ) {
        return false;
      }

      return true;
    });
  }, [searchQuery, selectedDatasourceType, selectedTag, templates]);

  const handleDeleteTemplate = useCallback(
    async (template: Template) => {
      if (!canDeleteTemplates) {
        return;
      }

      const confirmed = window.confirm(`Delete template "${template.metadata.title}" from Template Hub?`);
      if (!confirmed) {
        return;
      }

      setBusyTemplateId(template.metadata.id);
      try {
        await deleteTemplate(template.metadata.id, 'approved');
        setTemplates((current) => current.filter((item) => item.metadata.id !== template.metadata.id));
        appEvents.publish({
          type: AppEvents.alertSuccess.name,
          payload: [`Template "${template.metadata.title}" was removed from Template Hub.`],
        });
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : 'Failed to delete template';
        appEvents.publish({
          type: AppEvents.alertError.name,
          payload: ['Delete failed', message],
        });
      } finally {
        setBusyTemplateId(null);
      }
    },
    [appEvents, canDeleteTemplates]
  );

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>Template Hub</h1>
          <p className={styles.subtitle}>
            Browse approved dashboard templates and import them into this Grafana instance.
          </p>
          {!canPublishTemplates && (
            <p className={styles.subtitle}>
              Template publishing is available to users with the Template Hub publish permission or the Editor/Admin basic role.
            </p>
          )}
          {canPublishTemplates && (
            <p className={styles.subtitle}>New submissions go into an approval queue before they appear here.</p>
          )}
        </div>

        <div className={styles.heroActions}>
          {canReviewTemplates && (
            <button
              className={styles.secondaryButton}
              onClick={() => navigateToPath(buildPluginPath({ type: 'review' }))}
            >
              Review submissions
            </button>
          )}

          {canPublishTemplates && (
            <button
              className={styles.primaryButton}
              onClick={() => navigateToPath(buildPluginPath({ type: 'upload' }))}
            >
              Upload template
            </button>
          )}
        </div>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.input}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder="Search by title, description, or tags..."
        />

        <select
          className={styles.select}
          value={selectedTag}
          onChange={(event) => setSelectedTag(event.currentTarget.value)}
        >
          <option value="">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={selectedDatasourceType}
          onChange={(event) => setSelectedDatasourceType(event.currentTarget.value)}
        >
          <option value="">All datasources</option>
          {allDatasourceTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        {(searchQuery || selectedTag || selectedDatasourceType) && (
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setSearchQuery('');
              setSelectedTag('');
              setSelectedDatasourceType('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <div className={styles.infoBox}>Loading templates...</div>}

      {!loading && error && (
        <div className={styles.errorBox}>
          <strong>Could not load templates</strong>
          <div>{error}</div>
          <button className={styles.secondaryButton} onClick={fetchTemplates}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && templates.length === 0 && (
        <div className={styles.infoBox}>
          <strong>No templates available yet</strong>
          {canPublishTemplates ? (
            <>
              <p className={styles.subtitle}>Start by publishing a dashboard template for your team.</p>
              <button
                className={styles.primaryButton}
                onClick={() => navigateToPath(buildPluginPath({ type: 'upload' }))}
              >
                Upload your first template
              </button>
            </>
          ) : (
            <p className={styles.subtitle}>
              Approved templates will appear here for everyone to import.
            </p>
          )}
        </div>
      )}

      {!loading && !error && templates.length > 0 && filteredTemplates.length === 0 && (
        <div className={styles.infoBox}>
          <strong>No templates match the current filters</strong>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setSearchQuery('');
              setSelectedTag('');
              setSelectedDatasourceType('');
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {!loading && !error && filteredTemplates.length > 0 && (
        <>
          <div className={styles.summary}>
            {filteredTemplates.length} template{filteredTemplates.length === 1 ? '' : 's'}
            {filteredTemplates.length !== templates.length ? ` (filtered from ${templates.length})` : ''}
          </div>

          <div className={styles.grid}>
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.metadata.id}
                template={template}
                canDelete={canDeleteTemplates}
                deleting={busyTemplateId === template.metadata.id}
                onDelete={() => void handleDeleteTemplate(template)}
                onClick={() =>
                  navigateToPath(buildPluginPath({ type: 'template', templateId: template.metadata.id }))
                }
              />
            ))}
          </div>
        </>
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
    hero: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing(2),
      flexWrap: 'wrap',
    }),
    heroActions: css({
      display: 'flex',
      gap: theme.spacing(1),
      flexWrap: 'wrap',
    }),
    title: css({
      margin: 0,
      fontSize: theme.typography.h2.fontSize,
      lineHeight: theme.typography.h2.lineHeight,
    }),
    subtitle: css({
      margin: `${theme.spacing(1)} 0 0`,
      color: theme.colors.text.secondary,
    }),
    filters: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(260px, 1fr) 220px 220px auto',
      gap: theme.spacing(1.5),
      [theme.breakpoints.down('lg')]: {
        gridTemplateColumns: '1fr',
      },
    }),
    input: css({
      width: '100%',
      minHeight: '40px',
      padding: `0 ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      color: theme.colors.text.primary,
    }),
    select: css({
      width: '100%',
      minHeight: '40px',
      padding: `0 ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      color: theme.colors.text.primary,
    }),
    primaryButton: css({
      minHeight: '40px',
      padding: `0 ${theme.spacing(2)}`,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.primary.border}`,
      background: theme.colors.primary.main,
      color: theme.colors.primary.contrastText,
      fontWeight: theme.typography.fontWeightMedium,
      cursor: 'pointer',
    }),
    secondaryButton: css({
      minHeight: '40px',
      padding: `0 ${theme.spacing(2)}`,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.secondary,
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      cursor: 'pointer',
    }),
    infoBox: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
    }),
    errorBox: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.error.border}`,
      background: theme.colors.error.transparent,
      color: theme.colors.text.primary,
    }),
    summary: css({
      color: theme.colors.text.secondary,
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: theme.spacing(2),
    }),
  };
}
