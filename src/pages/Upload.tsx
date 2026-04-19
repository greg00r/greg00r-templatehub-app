import React from 'react';
import { Alert, Button, Icon, LoadingBar, Stack, Text } from '@grafana/ui';
import { UploadWizard } from '../components/UploadWizard';
import { useMarketplaceAccess } from '../hooks/useMarketplaceAccess';
import { buildPluginPath, navigateToPath } from '../utils/navigation';

export function Upload() {
  const { access, loading } = useMarketplaceAccess();
  const canPublishTemplates = access.publish;
  const canApproveTemplates = access.review;

  if (loading) {
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

        <LoadingBar width={280} />
      </div>
    );
  }

  if (!canPublishTemplates) {
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

        <Alert title="Publishing is restricted" severity="warning">
          You need the Template Hub publish permission or the Editor/Admin basic role to publish dashboard templates.
        </Alert>
      </div>
    );
  }

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
            Submit a reusable dashboard to Template Hub. Admins will review it before it goes live.
          </Text>
        </Stack>
      </div>

      <UploadWizard
        onSuccess={(_id, status) =>
          navigateToPath(buildPluginPath({ type: canApproveTemplates && status === 'pending' ? 'review' : 'gallery' }))
        }
      />
    </div>
  );
}
