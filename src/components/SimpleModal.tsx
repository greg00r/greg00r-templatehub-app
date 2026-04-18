import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Text, useStyles2 } from '@grafana/ui';

interface Props {
  title: string;
  onDismiss: () => void;
  children: React.ReactNode;
}

export function SimpleModal({ title, onDismiss, children }: Props) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.backdrop} role="presentation" onClick={onDismiss}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <Text element="h2" variant="h4">
            {title}
          </Text>
          <Button variant="secondary" fill="text" icon="times" onClick={onDismiss}>
            Close
          </Button>
        </div>

        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    backdrop: css({
      position: 'fixed',
      inset: 0,
      zIndex: 1100,
      background: 'rgba(0, 0, 0, 0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(3),
    }),
    modal: css({
      width: '100%',
      maxWidth: '960px',
      maxHeight: '85vh',
      overflowY: 'auto',
      background: theme.colors.background.primary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      boxShadow: theme.shadows.z3,
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    content: css({
      padding: theme.spacing(2),
    }),
  };
}
