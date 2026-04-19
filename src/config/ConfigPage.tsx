import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Field,
  Input,
  Select,
  Stack,
  Text,
  useStyles2,
} from '@grafana/ui';
import { GrafanaTheme2, AppEvents } from '@grafana/data';
import { css } from '@emotion/css';
import { getBackendSrv, getAppEvents } from '@grafana/runtime';
import type { AppPluginSettings, StorageBackend, ExternalAuthType } from '../types';

const PLUGIN_ID = 'greg00r-templatehub-app';

interface Props {
  plugin: {
    meta: {
      jsonData?: AppPluginSettings;
      secureJsonFields?: {
        externalAuthToken?: boolean;
        externalAuthPassword?: boolean;
      };
    };
  };
}

const AUTH_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Bearer Token', value: 'bearer' },
  { label: 'Basic Auth', value: 'basic' },
];

export function ConfigPage({ plugin }: Props) {
  const styles = useStyles2(getStyles);
  const appEvents = getAppEvents();
  const jsonData = (plugin.meta.jsonData ?? {}) as AppPluginSettings;
  const secureJsonFields = plugin.meta.secureJsonFields ?? {};

  const [storageBackend, setStorageBackend] = useState<StorageBackend>(
    jsonData.storageBackend ?? 'local'
  );
  const [localPath, setLocalPath] = useState(
    jsonData.localPath ?? '/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates'
  );
  const [externalUrl, setExternalUrl] = useState(jsonData.externalUrl ?? '');
  const [authType, setAuthType] = useState<ExternalAuthType>(jsonData.externalAuthType ?? 'none');
  const [authUsername, setAuthUsername] = useState(jsonData.externalAuthUsername ?? '');
  const [authSecret, setAuthSecret] = useState('');
  const [secretConfigured, setSecretConfigured] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const selectedAuthOption = useMemo(
    () => AUTH_OPTIONS.find((option) => option.value === authType),
    [authType]
  );

  useEffect(() => {
    if (authType === 'bearer') {
      setSecretConfigured(Boolean(secureJsonFields.externalAuthToken));
      return;
    }

    if (authType === 'basic') {
      setSecretConfigured(Boolean(secureJsonFields.externalAuthPassword));
      return;
    }

    setSecretConfigured(false);
  }, [authType, secureJsonFields.externalAuthPassword, secureJsonFields.externalAuthToken]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: {
        jsonData: AppPluginSettings;
        secureJsonData?: Record<string, string>;
      } = {
        jsonData: {
          storageBackend,
          localPath: storageBackend === 'local' ? localPath : undefined,
          externalUrl: storageBackend === 'external' ? externalUrl : undefined,
          externalAuthType: storageBackend === 'external' ? authType : undefined,
          externalAuthUsername:
            storageBackend === 'external' && authType === 'basic' ? authUsername : undefined,
        },
      };

      if ((authType === 'bearer' || authType === 'basic') && authSecret.trim()) {
        payload.secureJsonData =
          authType === 'bearer'
            ? { externalAuthToken: authSecret.trim() }
            : { externalAuthPassword: authSecret.trim() };
      }

      await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/settings`, payload);
      setAuthSecret('');
      setSecretConfigured(authType === 'bearer' || authType === 'basic');

      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: ['Plugin settings saved'],
      });
    } catch (err) {
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Failed to save settings', err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await getBackendSrv().get(
        `/api/plugins/${PLUGIN_ID}/resources/health`
      );
      setTestResult({ ok: true, message: 'Connection successful' });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleInitialize = async () => {
    setInitializing(true);
    try {
      await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/resources/initialize`, {});
      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: ['Storage directory initialized'],
      });
    } catch (err) {
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Initialization failed', err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className={styles.container}>
      <Text element="h3" variant="h3">
        Storage Configuration
      </Text>

      {/* Storage backend switch */}
      <Field
        label="Storage backend"
        description="Choose where templates are stored."
      >
        <div className={styles.toggleRow}>
          <Button
            variant={storageBackend === 'local' ? 'primary' : 'secondary'}
            onClick={() => setStorageBackend('local')}
          >
            Local (PVC)
          </Button>
          <Button
            variant={storageBackend === 'external' ? 'primary' : 'secondary'}
            onClick={() => setStorageBackend('external')}
          >
            External HTTP
          </Button>
        </div>
      </Field>

      {/* Local storage settings */}
      {storageBackend === 'local' && (
        <div className={styles.section}>
          <Field
            label="Templates directory"
            description="Absolute path to the directory where templates are stored on the Grafana PVC."
          >
            <Input
              value={localPath}
              onChange={(e) => setLocalPath(e.currentTarget.value)}
              placeholder="/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates"
            />
          </Field>

          <Button
            variant="secondary"
            onClick={handleInitialize}
            disabled={initializing}
            icon="folder-plus"
          >
            {initializing ? 'Initializing…' : 'Initialize directory'}
          </Button>
        </div>
      )}

      {/* External storage settings */}
      {storageBackend === 'external' && (
        <div className={styles.section}>
          <Field label="External URL" description="Base URL of the external templates API.">
            <Input
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.currentTarget.value)}
              placeholder="https://templates.mycompany.internal/api"
            />
          </Field>

          <Field label="Authentication">
            <Select
              options={AUTH_OPTIONS}
              value={selectedAuthOption}
              onChange={(val) => setAuthType(val.value as ExternalAuthType)}
            />
          </Field>

          {authType === 'basic' && (
            <Field label="Username">
              <Input
                value={authUsername}
                onChange={(e) => setAuthUsername(e.currentTarget.value)}
                placeholder="username"
              />
            </Field>
          )}

          {(authType === 'bearer' || authType === 'basic') && (
            <Field
              label={authType === 'bearer' ? 'Bearer token' : 'Password'}
              description="Stored securely and never exposed to the browser."
            >
              <div className={styles.secretRow}>
                <Input
                  type="password"
                  value={authSecret}
                  placeholder={
                    secretConfigured && !authSecret
                      ? 'Secret already configured'
                      : authType === 'bearer'
                        ? 'Bearer token'
                        : 'Password'
                  }
                  onChange={(e) => {
                    setAuthSecret(e.currentTarget.value);
                    setSecretConfigured(false);
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAuthSecret('');
                    setSecretConfigured(false);
                  }}
                >
                  Clear
                </Button>
              </div>
            </Field>
          )}

          <Stack gap={2} alignItems="center">
            <Button
              variant="secondary"
              onClick={handleTestConnection}
              disabled={testing || !externalUrl}
              icon="sync"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>

            {testResult && (
              <Alert
                title={testResult.message}
                severity={testResult.ok ? 'success' : 'error'}
                style={{ marginBottom: 0 }}
              />
            )}
          </Stack>
        </div>
      )}

      <div style={{ marginTop: '24px' }}>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving}
          icon="save"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      maxWidth: '600px',
    }),
    section: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      marginBottom: theme.spacing(2),
    }),
    toggleRow: css({
      display: 'flex',
      gap: theme.spacing(1),
      flexWrap: 'wrap',
    }),
    secretRow: css({
      display: 'flex',
      gap: theme.spacing(1),
      alignItems: 'center',
    }),
  };
}
