import React, { useCallback, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2 } from '@grafana/data';
import {
  Alert,
  Button,
  Field,
  Input,
  MultiSelect,
  Select,
  Stack,
  Text,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { getDashboardByUid, searchDashboards } from '../api/grafana';
import { uploadTemplate } from '../api/templates';
import { FileUploadArea } from './FileUploadArea';
import { MarkdownContent } from './MarkdownContent';
import type { GrafanaDashboard, RequiredDatasource, TemplateMetadata, TemplateVariable } from '../types';
import {
  detectRequiredDatasources,
  extractTemplateVariablesFromDashboard,
} from '../utils/templateIntrospection';

interface Props {
  onSuccess: (templateId: string) => void;
}

type WizardStep = 0 | 1 | 2 | 3 | 4;
type EditableTemplateVariable = TemplateVariable & { rowId: string };

const DATASOURCE_TYPES = [
  'prometheus',
  'loki',
  'influxdb',
  'elasticsearch',
  'graphite',
  'mysql',
  'postgres',
  'mssql',
  'cloudwatch',
  'azuremonitor',
  'tempo',
  'jaeger',
  'zipkin',
  'testdata',
].map((value) => ({ label: value, value }));

export function UploadWizard({ onSuccess }: Props) {
  const styles = useStyles2(getStyles);
  const appEvents = getAppEvents();

  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [dashboardJson, setDashboardJson] = useState<GrafanaDashboard | null>(null);
  const [dashboardRawText, setDashboardRawText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ label: string; value: string }>>([]);

  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [requiredDatasources, setRequiredDatasources] = useState<RequiredDatasource[]>([]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [variables, setVariables] = useState<EditableTemplateVariable[]>([]);
  const nextVariableIdRef = useRef(0);

  const handleJsonTextChange = (text: string) => {
    setDashboardRawText(text);
    setJsonError(null);

    if (!text.trim()) {
      setDashboardJson(null);
      return;
    }

    try {
      const parsed = JSON.parse(text) as GrafanaDashboard;
      setDashboardJson(parsed);

      if (!title) {
        setTitle(parsed.title ?? '');
      }

      setRequiredDatasources(detectRequiredDatasources(parsed));
      setVariables(toEditableVariables(extractTemplateVariablesFromDashboard(parsed), nextVariableIdRef));
    } catch {
      setDashboardJson(null);
      setJsonError('Invalid dashboard JSON');
    }
  };

  const handleDashboardFileUpload = (files: FileList | File[]) => {
    const file = files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => handleJsonTextChange(String(event.target?.result ?? ''));
    reader.readAsText(file);
  };

  const handleDashboardSearch = useCallback(async (query: string) => {
    setDashboardSearch(query);
    if (!query) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await searchDashboards(query);
      setSearchResults(
        results.map((result) => ({
          label: `${result.title} (${result.folderTitle ?? 'General'})`,
          value: result.uid,
        }))
      );
    } catch {
      setSearchResults([]);
    }
  }, []);

  const handleSelectDashboard = async (uid: string) => {
    try {
      const { dashboard } = await getDashboardByUid(uid);
      const serialized = JSON.stringify(dashboard, null, 2);
      handleJsonTextChange(serialized);
      setDashboardRawText(serialized);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Failed to load dashboard');
    }
  };

  const handleImageDrop = (files: FileList | File[]) => {
    const file = files[0];
    if (!file) {
      return;
    }

    setSubmitError(null);
    setImageError(null);

    if (file.size > 2 * 1024 * 1024) {
      setImageFile(null);
      setImagePreview(null);
      setImageError('Image must be smaller than 2 MB');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setImageFile(null);
      setImagePreview(null);
      setImageError('File must be an image');
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => setImagePreview(String(event.target?.result ?? ''));
    reader.readAsDataURL(file);
  };

  const updateVariable = (index: number, updates: Partial<EditableTemplateVariable>) => {
    setSubmitError(null);
    setVariables((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...updates } : item)));
  };

  const removeVariable = (index: number) => {
    setSubmitError(null);
    setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const addVariable = () => {
    setSubmitError(null);
    setVariables((current) => [
      ...current,
      {
        rowId: createVariableRowId(nextVariableIdRef),
        name: '',
        label: '',
        type: 'textbox',
        required: false,
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!dashboardJson) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const metadataPayload: Omit<TemplateMetadata, 'id'> = {
        title,
        shortDescription,
        longDescription,
        tags,
        requiredDatasources,
        author: 'Unknown',
        version: '1.0.0',
        createdAt: today,
        updatedAt: today,
      };

      const result = await uploadTemplate({
        templateJson: JSON.stringify(dashboardJson),
        metadata: JSON.stringify(metadataPayload),
        variablesJson: JSON.stringify({ variables: stripEditableVariables(variables) }),
        image: imageFile ?? undefined,
      });

      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Template "${title}" uploaded successfully.`],
      });

      onSuccess(result.id);
    } catch (error) {
      const message = getUploadErrorMessage(error);
      setSubmitError(message);
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Upload failed', message],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const steps = ['Dashboard JSON', 'Metadata', 'Image', 'Variables', 'Preview & Save'];

  const canAdvanceFrom: Record<WizardStep, boolean> = {
    0: Boolean(dashboardJson) && !jsonError,
    1: Boolean(title.trim()) && Boolean(shortDescription.trim()),
    2: !imageError,
    3: true,
    4: true,
  };

  return (
    <div>
      <div className={styles.stepper}>
        {steps.map((label, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <div
              key={label}
              className={`${styles.stepItem} ${isActive ? styles.stepItemActive : ''}`}
            >
              <span className={`${styles.stepBadge} ${isCompleted ? styles.stepBadgeComplete : ''}`}>
                {index + 1}
              </span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.stepContent}>
        {currentStep === 0 && (
          <Stack direction="column" gap={2}>
            <Text color="secondary">
              Paste dashboard JSON, upload a file, or select an existing dashboard from Grafana.
            </Text>

            <Field label="Import from existing Grafana dashboard">
              <Select
                options={searchResults}
                onInputChange={handleDashboardSearch}
                onChange={(item) => item?.value && handleSelectDashboard(String(item.value))}
                placeholder="Search dashboards..."
                filterOption={() => true}
                noOptionsMessage={dashboardSearch ? 'No dashboards found' : 'Start typing to search'}
                isClearable
              />
            </Field>

            <FileUploadArea
              accept=".json,application/json"
              buttonLabel="Choose dashboard JSON"
              helpText="Select dashboard.json from disk"
              onSelect={handleDashboardFileUpload}
            />

            <Field label="Dashboard JSON" invalid={Boolean(jsonError)} error={jsonError ?? undefined}>
              <TextArea
                rows={12}
                value={dashboardRawText}
                onChange={(event) => handleJsonTextChange(event.currentTarget.value)}
                placeholder='{ "title": "My Dashboard" }'
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </Field>

            {dashboardJson && <Alert title={`Loaded: "${dashboardJson.title}"`} severity="success" />}
          </Stack>
        )}

        {currentStep === 1 && (
          <Stack direction="column" gap={2}>
            <Field label="Title" required>
              <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
            </Field>

            <Field label="Short description" required>
              <Input
                value={shortDescription}
                onChange={(event) => setShortDescription(event.currentTarget.value)}
                maxLength={200}
              />
            </Field>

            <Field label="Long description (Markdown)">
              <div style={{ width: '100%' }}>
                <Stack direction="row" gap={2}>
                  <div style={{ flex: 1 }}>
                    <TextArea
                      rows={12}
                      value={longDescription}
                      onChange={(event) => setLongDescription(event.currentTarget.value)}
                      placeholder="# Overview"
                    />
                  </div>
                  <div className={styles.markdownPreview}>
                    <Text variant="bodySmall" color="secondary">
                      Preview
                    </Text>
                    <MarkdownContent
                      className={styles.markdownContent}
                      content={longDescription || '*Nothing to preview yet.*'}
                    />
                  </div>
                </Stack>
              </div>
            </Field>

            <Field label="Tags">
              <MultiSelect
                options={tags.map((tag) => ({ label: tag, value: tag }))}
                value={tags.map((tag) => ({ label: tag, value: tag }))}
                onChange={(items) => setTags(items.map((item) => String(item.value)))}
                allowCustomValue
                closeMenuOnSelect={false}
                placeholder="Type and press Enter to add tags"
              />
            </Field>

            <Field label="Required datasources">
              <MultiSelect
                options={DATASOURCE_TYPES}
                value={requiredDatasources.map((datasource) => ({ label: datasource.type, value: datasource.type }))}
                onChange={(items) =>
                  setRequiredDatasources(
                    items.map((item) => ({ type: String(item.value), name: String(item.value) }))
                  )
                }
                closeMenuOnSelect={false}
                isClearable
                placeholder="Select datasource types"
              />
            </Field>
          </Stack>
        )}

        {currentStep === 2 && (
          <Stack direction="column" gap={2}>
            <Text color="secondary">
              Upload a preview image. PNG or JPG works best, maximum 2 MB.
            </Text>

            <FileUploadArea
              accept=".png,.jpg,.jpeg,.webp,.gif,image/*"
              buttonLabel="Choose preview image"
              helpText="Select PNG, JPG, WEBP, or GIF from disk"
              onSelect={handleImageDrop}
            />

            {imageError && <Alert title={imageError} severity="error" />}

            {imagePreview && (
              <div>
                <Text color="secondary">Preview</Text>
                <img
                  src={imagePreview}
                  alt="Template preview"
                  style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', marginTop: '8px' }}
                />
                {imageFile && (
                  <Text color="secondary" style={{ display: 'block', marginTop: '8px' }}>
                    Selected image: {imageFile.name} ({formatFileSize(imageFile.size)}, {imageFile.type || 'unknown type'})
                  </Text>
                )}
              </div>
            )}

            {!imagePreview && (
              <Alert title="Image is optional" severity="info">
                Without an image, the gallery will show a simple placeholder.
              </Alert>
            )}
          </Stack>
        )}

        {currentStep === 3 && (
          <Stack direction="column" gap={2}>
            <Text color="secondary">
              These variables are presented to users during import. They were auto-detected from the dashboard templating section.
            </Text>

            {variables.map((variable, index) => (
              <div key={variable.rowId} className={styles.variableRow}>
                <Stack direction="row" gap={1} alignItems="flex-end" wrap="wrap">
                  <Field label="Name" style={{ minWidth: '120px' }}>
                    <Input
                      value={variable.name}
                      onChange={(event) => updateVariable(index, { name: event.currentTarget.value })}
                    />
                  </Field>

                  <Field label="Label" style={{ minWidth: '160px' }}>
                    <Input
                      value={variable.label}
                      onChange={(event) => updateVariable(index, { label: event.currentTarget.value })}
                    />
                  </Field>

                  <Field label="Type">
                    <Select
                      options={[
                        { label: 'Text box', value: 'textbox' },
                        { label: 'Custom', value: 'custom' },
                        { label: 'Query', value: 'query' },
                        { label: 'Constant', value: 'constant' },
                        { label: 'Datasource', value: 'datasource' },
                      ]}
                      value={{ label: variable.type, value: variable.type }}
                      onChange={(item) => updateVariable(index, { type: item.value as TemplateVariable['type'] })}
                    />
                  </Field>

                  <Field label="Default" style={{ minWidth: '160px' }}>
                    <Input
                      value={variable.default ?? ''}
                      onChange={(event) => updateVariable(index, { default: event.currentTarget.value })}
                    />
                  </Field>

                  <Button
                    variant="destructive"
                    fill="outline"
                    icon="trash-alt"
                    onClick={() => removeVariable(index)}
                    style={{ marginBottom: '4px' }}
                  />
                </Stack>

                <Field label="Description">
                  <Input
                    value={variable.description ?? ''}
                    onChange={(event) => updateVariable(index, { description: event.currentTarget.value })}
                  />
                </Field>
              </div>
            ))}

            <Button variant="secondary" icon="plus" onClick={addVariable}>
              Add variable
            </Button>
          </Stack>
        )}

        {currentStep === 4 && (
          <Stack direction="column" gap={2}>
            <Text variant="h4">Ready to publish</Text>

            <div className={styles.previewCard}>
              <Stack direction="row" gap={2} alignItems="flex-start">
                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="Preview"
                    style={{ width: '180px', height: '112px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }}
                  />
                )}

                <Stack direction="column" gap={0.5}>
                  <Text variant="h5">{title || 'Untitled'}</Text>
                  <Text color="secondary">{shortDescription}</Text>
                  <Text variant="bodySmall" color="secondary">
                    Datasources: {requiredDatasources.map((item) => item.type).join(', ') || '-'}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Variables: {variables.length}
                  </Text>
                </Stack>
              </Stack>
            </div>

            {submitError && (
              <Alert title="Upload failed" severity="error">
                {submitError}
              </Alert>
            )}

            <Button variant="primary" size="lg" icon="save" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Publishing...' : 'Publish template'}
            </Button>
          </Stack>
        )}
      </div>

      <div style={{ marginTop: '24px' }}>
        <Stack justifyContent="flex-end" gap={2}>
          {currentStep > 0 && (
            <Button variant="secondary" onClick={() => setCurrentStep((step) => (step - 1) as WizardStep)}>
              Back
            </Button>
          )}

          {currentStep < 4 && (
            <Button
              variant="primary"
              onClick={() => setCurrentStep((step) => (step + 1) as WizardStep)}
              disabled={!canAdvanceFrom[currentStep]}
            >
              Next
            </Button>
          )}
        </Stack>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    stepContent: css({
      minHeight: '300px',
      padding: `${theme.spacing(2)} 0`,
    }),
    stepper: css({
      display: 'grid',
      gap: theme.spacing(1),
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      marginBottom: theme.spacing(2),
    }),
    stepItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(1),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    stepItemActive: css({
      borderColor: theme.colors.primary.border,
      color: theme.colors.text.primary,
      boxShadow: `inset 0 0 0 1px ${theme.colors.primary.border}`,
    }),
    stepBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '24px',
      height: '24px',
      padding: '0 6px',
      borderRadius: '999px',
      background: theme.colors.border.medium,
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    stepBadgeComplete: css({
      background: theme.colors.success.main,
      color: theme.colors.success.contrastText,
    }),
    variableRow: css({
      padding: theme.spacing(1.5),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    markdownPreview: css({
      flex: 1,
      padding: theme.spacing(1),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      maxHeight: '300px',
      overflowY: 'auto',
    }),
    markdownContent: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    previewCard: css({
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
    }),
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function toEditableVariables(
  variables: TemplateVariable[],
  nextVariableIdRef: React.MutableRefObject<number>
): EditableTemplateVariable[] {
  return variables.map((variable) => ({
    ...variable,
    rowId: createVariableRowId(nextVariableIdRef),
  }));
}

function createVariableRowId(nextVariableIdRef: React.MutableRefObject<number>): string {
  nextVariableIdRef.current += 1;
  return `variable-row-${nextVariableIdRef.current}`;
}

function stripEditableVariables(variables: EditableTemplateVariable[]): TemplateVariable[] {
  return variables.map(({ rowId, ...variable }) => variable);
}

function getUploadErrorMessage(error: unknown): string {
  const fallback = 'Upload failed';
  const message = error instanceof Error ? error.message.trim() : '';

  if (!message || message === fallback) {
    return `${fallback}. If you updated the plugin recently, hard refresh the page with Ctrl+F5 and try again.`;
  }

  return message;
}
