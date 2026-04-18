import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { getTemplateImageUrl } from '../api/templates';
import type { Template } from '../types';

interface Props {
  template: Template;
  onClick: () => void;
}

export function TemplateCard({ template, onClick }: Props) {
  const styles = useStyles2(getStyles);
  const { metadata } = template;

  return (
    <div
      className={styles.card}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open template ${metadata.title}`}
    >
      <div className={styles.figure}>
        <img
          src={getTemplateImageUrl(metadata.id)}
          alt={`${metadata.title} preview`}
          className={styles.image}
          onError={(event) => {
            const element = event.target as HTMLImageElement;
            element.style.display = 'none';
            const placeholder = element.nextElementSibling as HTMLElement | null;
            if (placeholder) {
              placeholder.style.display = 'flex';
            }
          }}
        />
        <div className={styles.imagePlaceholder} style={{ display: 'none' }}>
          <span style={{ fontSize: '40px', opacity: 0.3 }}>Preview</span>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.title}>{metadata.title}</div>
        <div className={styles.description}>{metadata.shortDescription}</div>

        <div className={styles.tags}>
          {(metadata.tags ?? []).slice(0, 4).map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
          {(metadata.tags ?? []).length > 4 && (
            <span className={styles.moreTag}>+{metadata.tags.length - 4} more</span>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.meta}>v{metadata.version} by {metadata.author}</span>
          {metadata.requiredDatasources?.length ? (
            <span className={styles.meta}>
              {metadata.requiredDatasources.map((datasource) => datasource.type).join(', ')}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    card: css({
      cursor: 'pointer',
      transition: 'box-shadow 0.15s ease',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      '&:hover': {
        boxShadow: theme.shadows.z3,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '2px',
      },
    }),
    figure: css({
      position: 'relative',
      width: '100%',
      aspectRatio: '16 / 9',
      overflow: 'hidden',
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
    }),
    image: css({
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    }),
    imagePlaceholder: css({
      position: 'absolute',
      inset: 0,
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.colors.background.secondary,
    }),
    content: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),
    title: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    description: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    tags: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(1),
    }),
    tag: css({
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: '24px',
      padding: `0 ${theme.spacing(1)}`,
      borderRadius: '999px',
      background: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    moreTag: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    footer: css({
      display: 'flex',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      flexWrap: 'wrap',
    }),
    meta: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
  };
}
