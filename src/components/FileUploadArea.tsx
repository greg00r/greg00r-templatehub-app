import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Text, useStyles2 } from '@grafana/ui';

interface Props {
  accept?: string;
  buttonLabel: string;
  helpText: string;
  onSelect: (files: FileList) => void;
}

export function FileUploadArea({ accept, buttonLabel, helpText, onSelect }: Props) {
  const styles = useStyles2(getStyles);

  return (
    <label className={styles.wrapper}>
      <input
        type="file"
        accept={accept}
        className={styles.input}
        onChange={(event) => {
          if (event.currentTarget.files?.length) {
            onSelect(event.currentTarget.files);
            event.currentTarget.value = '';
          }
        }}
      />
      <Text color="secondary">{helpText}</Text>
      <Button type="button" variant="secondary">
        {buttonLabel}
      </Button>
    </label>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1.5),
      minHeight: '140px',
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px dashed ${theme.colors.border.medium}`,
      background: theme.colors.background.secondary,
      cursor: 'pointer',
      textAlign: 'center',
    }),
    input: css({
      display: 'none',
    }),
  };
}
