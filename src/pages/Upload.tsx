import React from 'react';
import { Button, Icon, Stack, Text } from '@grafana/ui';
import { UploadWizard } from '../components/UploadWizard';
import { buildPluginPath, navigateToPath } from '../utils/navigation';

export function Upload() {
  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <Button
        variant="secondary"
        size="sm"
        fill="text"
        onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}
        style={{ marginBottom: '16px' }}
      >
        <Icon name="arrow-left" /> Back to gallery
      </Button>

      <div style={{ marginBottom: '24px' }}>
        <Stack direction="column" gap={0.5}>
          <Text element="h1" variant="h2">Upload Dashboard Template</Text>
          <Text color="secondary">
            Publish a reusable dashboard to the organization marketplace.
          </Text>
        </Stack>
      </div>

      <UploadWizard
        onSuccess={(id) => navigateToPath(buildPluginPath({ type: 'template', templateId: id }))}
      />
    </div>
  );
}
