import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2 } from '@grafana/data';
import {
  Alert,
  Button,
  Field,
  Input,
  Stack,
  Text,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { getAvailableDatasourceTypes, getDashboardByUid, searchDashboards } from '../api/grafana';
import { uploadTemplate } from '../api/templates';
import { getCurrentUserDisplayName } from '../utils/access';
import { FileUploadArea } from './FileUploadArea';
import { MarkdownContent } from './MarkdownContent';
import type {
  GrafanaDashboard,
  GrafanaDatasourcePlugin,
  GrafanaVariable,
  RequiredDatasource,
  TemplateMetadata,
  TemplateStatus,
  TemplateVariable,
} from '../types';
import {
  detectRequiredDatasources,
  extractTemplateVariablesFromDashboard,
} from '../utils/templateIntrospection';

interface Props {
  onSuccess: (templateId: string, status: TemplateStatus) => void;
}

type WizardStep = 0 | 1 | 2 | 3 | 4;
type DashboardSearchOption = { label: string; value: string; folderTitle?: string };

type EditableTemplateVariable = TemplateVariable & {
  rowId: string;
  includeInImport: boolean;
  useCustomValue: boolean;
  detected: TemplateVariable;
};

const TEMPLATE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function UploadWizard({ onSuccess }: Props) {
  const styles = useStyles2(getStyles);
  const appEvents = getAppEvents();
  const currentAuthor = getCurrentUserDisplayName();

  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [dashboardJson, setDashboardJson] = useState<GrafanaDashboard | null>(null);
  const [dashboardRawText, setDashboardRawText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<DashboardSearchOption[]>([]);

  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [templateFolder, setTemplateFolder] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [tags, setTags] = useState<string[]>([]);
  const [requiredDatasources, setRequiredDatasources] = useState<RequiredDatasource[]>([]);
  const [availableDatasourceTypes, setAvailableDatasourceTypes] = useState<GrafanaDatasourcePlugin[]>([]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [variables, setVariables] = useState<EditableTemplateVariable[]>([]);
  const nextVariableIdRef = useRef(0);

  useEffect(() => {
    getAvailableDatasourceTypes()
      .then(setAvailableDatasourceTypes)
      .catch(() => setAvailableDatasourceTypes([]));
  }, []);

  const handleJsonTextChange = (text: string) => {
    setDashboardRawText(text);
    setJsonError(null);

    if (!text.trim()) {
      setDashboardJson(null);
      setRequiredDatasources([]);
      setVariables([]);
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

  const loadDashboardSearchResults = useCallback(async (query: string) => {
    setSearchLoading(true);

    try {
      const results = await searchDashboards(query);
      setSearchResults(
        results.map((result) => ({
          label: `${result.title} (${result.folderTitle ?? 'General'})`,
          value: result.uid,
          folderTitle: result.folderTitle,
        }))
      );
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleDashboardSearch = useCallback(
    async (query: string) => {
      setDashboardSearch(query);
      await loadDashboardSearchResults(query);
    },
    [loadDashboardSearchResults]
  );

  useEffect(() => {
    if (currentStep !== 0) {
      return;
    }

    if (dashboardSearch.trim() || searchResults.length > 0 || searchLoading) {
      return;
    }

    void loadDashboardSearchResults('');
  }, [currentStep, dashboardSearch, loadDashboardSearchResults, searchLoading, searchResults.length]);

  const handleSelectDashboard = async (uid: string) => {
    try {
      const selectedResult = searchResults.find((result) => result.value === uid);
      const { dashboard } = await getDashboardByUid(uid);
      const serialized = JSON.stringify(dashboard, null, 2);
      handleJsonTextChange(serialized);
      setDashboardRawText(serialized);
      setTemplateFolder(selectedResult?.folderTitle ?? '');
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

  const handleSubmit = async () => {
    if (!dashboardJson) {
      return;
    }

    const effectiveVariables = variables.map(materializeEditableVariable);
    const validationError = getPublishValidationError({
      title,
      shortDescription,
      version,
      variables: effectiveVariables,
    });
    if (validationError) {
      setSubmitError(validationError);
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
        folder: templateFolder.trim() || undefined,
        requiredDatasources,
        author: currentAuthor,
        version,
        createdAt: today,
        updatedAt: today,
      };

      const templateDashboard = buildDashboardTemplateForUpload(dashboardJson, variables);
      const importVariables = variables
        .filter((variable) => variable.includeInImport)
        .map(materializeEditableVariable);

      const result = await uploadTemplate({
        templateJson: JSON.stringify(templateDashboard),
        metadata: JSON.stringify(metadataPayload),
        variablesJson: JSON.stringify({ variables: importVariables }),
        image: imageFile ?? undefined,
      });

      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Template "${title}" was submitted for admin approval.`],
      });

      onSuccess(result.id, result.status ?? 'pending');
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
  const effectiveVariables = variables.map(materializeEditableVariable);
  const variableValidationError = getVariableValidationError(effectiveVariables);
  const datasourceTypeOptions = buildDatasourceTypeOptions(availableDatasourceTypes, requiredDatasources);

  const canAdvanceFrom: Record<WizardStep, boolean> = {
    0: Boolean(dashboardJson) && !jsonError,
    1: Boolean(title.trim()) && Boolean(shortDescription.trim()) && isTemplateVersionValid(version),
    2: !imageError,
    3: !variableValidationError,
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
              <div style={{ width: '100%' }}>
                <Input
                  value={dashboardSearch}
                  onChange={(event) => handleDashboardSearch(event.currentTarget.value)}
                  onFocus={() => {
                    if (!dashboardSearch.trim() && searchResults.length === 0 && !searchLoading) {
                      void loadDashboardSearchResults('');
                    }
                  }}
                  placeholder="Search dashboards..."
                />

                {searchLoading && (
                  <div style={{ marginTop: '8px' }}>
                    <Text color="secondary">
                      {dashboardSearch.trim() ? 'Searching dashboards...' : 'Loading recent dashboards...'}
                    </Text>
                  </div>
                )}

                {!searchLoading && searchResults.length === 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <Text color="secondary">
                      {dashboardSearch.trim()
                        ? 'No dashboards found'
                        : 'Recent dashboards will appear here once they exist in Grafana.'}
                    </Text>
                  </div>
                )}

                {!searchLoading && searchResults.length > 0 && (
                  <div
                    style={{
                      marginTop: '8px',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      border: '1px solid var(--grafana-border-weak, #2f3440)',
                      borderRadius: '8px',
                    }}
                  >
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--grafana-border-weak, #2f3440)' }}>
                      <Text color="secondary">
                        {dashboardSearch.trim() ? 'Matching dashboards' : 'Recent dashboards'}
                      </Text>
                    </div>
                    {searchResults.map((result) => (
                      <button
                        key={result.value}
                        type="button"
                        onClick={() => handleSelectDashboard(result.value)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 12px',
                          border: 'none',
                          background: 'transparent',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        {result.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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

            <Field
              label="Folder"
              description="Optional category or source folder shown on the Template Hub card."
            >
              <Input
                value={templateFolder}
                onChange={(event) => setTemplateFolder(event.currentTarget.value)}
                placeholder="Platform / Observability / Team A"
              />
            </Field>

            <Field
              label="Version"
              required
              invalid={Boolean(version) && !isTemplateVersionValid(version)}
              error={version && !isTemplateVersionValid(version) ? 'Use semantic versioning like 1.2.3' : undefined}
            >
              <Input value={version} onChange={(event) => setVersion(event.currentTarget.value)} placeholder="1.0.0" />
            </Field>

            <Field label="Tags">
              <Input
                value={tags.join(', ')}
                onChange={(event) => setTags(parseCommaSeparatedValues(event.currentTarget.value))}
                placeholder="tag-one, tag-two, tag-three"
              />
            </Field>

            <Field label="Required datasources">
              <div
                style={{
                  display: 'grid',
                  gap: '8px',
                  maxHeight: '240px',
                  overflowY: 'auto',
                  padding: '12px',
                  border: '1px solid var(--grafana-border-weak, #2f3440)',
                  borderRadius: '8px',
                }}
              >
                {datasourceTypeOptions.length === 0 && (
                  <Text color="secondary">No datasource types available in this Grafana instance.</Text>
                )}

                {datasourceTypeOptions.map((option) => {
                  const checked = requiredDatasources.some((datasource) => datasource.type === option.value);

                  return (
                    <label
                      key={option.value}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const isChecked = event.currentTarget.checked;

                          setRequiredDatasources((current) => {
                            if (isChecked) {
                              return [
                                ...current,
                                {
                                  type: option.value,
                                  name: resolveDatasourceDisplayName(option.value, availableDatasourceTypes),
                                },
                              ];
                            }

                            return current.filter((datasource) => datasource.type !== option.value);
                          });
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
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
                  <div style={{ marginTop: '8px' }}>
                    <Text color="secondary">
                      Selected image: {imageFile.name} ({formatFileSize(imageFile.size)}, {imageFile.type || 'unknown type'})
                    </Text>
                  </div>
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
              Variables were auto-detected from the dashboard templating section. Choose which ones should be asked during
              import and optionally replace the detected content before the template is published.
            </Text>

            {variableValidationError && (
              <Alert title="Variables need attention" severity="warning">
                {variableValidationError}
              </Alert>
            )}

            {variables.map((variable, index) => (
              <div key={variable.rowId} className={styles.variableRow}>
                <Stack direction="column" gap={1.5}>
                  <Stack direction="row" gap={1} alignItems="flex-end" wrap="wrap">
                    <Field label="Name" style={{ minWidth: '180px' }}>
                      <Input value={variable.name} disabled />
                    </Field>

                    <Field label="Label" style={{ minWidth: '180px' }}>
                      <Input
                        value={variable.label}
                        onChange={(event) => updateVariable(index, { label: event.currentTarget.value })}
                      />
                    </Field>

                    <Field label="Type">
                      <Input value={variable.type} disabled />
                    </Field>
                  </Stack>

                  <Text color="secondary">Detected content: {getVariableContentPreview(variable.detected)}</Text>
                  {variable.detected.datasource && (
                    <Text color="secondary">Datasource reference: {variable.detected.datasource}</Text>
                  )}

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={variable.includeInImport}
                      onChange={(event) => updateVariable(index, { includeInImport: event.target.checked })}
                    />
                    <span>Ask during import</span>
                  </label>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={variable.useCustomValue}
                      onChange={(event) => updateVariable(index, { useCustomValue: event.target.checked })}
                    />
                    <span>Use custom content</span>
                  </label>

                  {variable.useCustomValue && renderVariableContentEditor(variable, index, updateVariable)}

                  <Field label="Description">
                    <Input
                      value={variable.description ?? ''}
                      onChange={(event) => updateVariable(index, { description: event.currentTarget.value })}
                    />
                  </Field>
                </Stack>
              </div>
            ))}
          </Stack>
        )}

        {currentStep === 4 && (
          <Stack direction="column" gap={2}>
            <Text variant="h4">Ready to submit</Text>

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
                    Author: {currentAuthor}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Folder: {templateFolder.trim() || 'General'}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Version: {version || '-'}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Datasources: {requiredDatasources.map((item) => item.type).join(', ') || '-'}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Variables asked during import: {variables.filter((variable) => variable.includeInImport).length}
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
              {submitting ? 'Submitting...' : 'Submit for approval'}
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

function renderVariableContentEditor(
  variable: EditableTemplateVariable,
  index: number,
  updateVariable: (index: number, updates: Partial<EditableTemplateVariable>) => void
) {
  switch (variable.type) {
    case 'textbox':
    case 'constant':
      return (
        <Field label="Custom default value">
          <Input
            value={variable.default ?? ''}
            onChange={(event) => updateVariable(index, { default: event.currentTarget.value })}
          />
        </Field>
      );

    case 'custom':
      return (
        <Field label="Custom options" description="Use commas or new lines to define the available options.">
          <TextArea
            rows={4}
            value={(variable.options ?? []).join('\n')}
            onChange={(event) =>
              updateVariable(index, {
                options: parseCustomOptions(event.currentTarget.value),
              })
            }
          />
        </Field>
      );

    case 'query':
      return (
        <Field label="Custom query">
          <TextArea
            rows={4}
            value={variable.query ?? ''}
            onChange={(event) => updateVariable(index, { query: event.currentTarget.value })}
          />
        </Field>
      );

    case 'datasource':
      return (
        <Field label="Custom datasource type">
          <Input
            value={variable.datasourceType ?? ''}
            onChange={(event) => updateVariable(index, { datasourceType: event.currentTarget.value })}
          />
        </Field>
      );

    default:
      return null;
  }
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
    ...cloneTemplateVariable(variable),
    rowId: createVariableRowId(nextVariableIdRef),
    includeInImport: false,
    useCustomValue: false,
    detected: cloneTemplateVariable(variable),
  }));
}

function createVariableRowId(nextVariableIdRef: React.MutableRefObject<number>): string {
  nextVariableIdRef.current += 1;
  return `variable-row-${nextVariableIdRef.current}`;
}

function cloneTemplateVariable(variable: TemplateVariable): TemplateVariable {
  return {
    ...variable,
    options: variable.options ? [...variable.options] : undefined,
  };
}

function materializeEditableVariable(variable: EditableTemplateVariable): TemplateVariable {
  const contentSource = variable.useCustomValue ? variable : variable.detected;
  const options = contentSource.type === 'custom' ? normalizeOptions(contentSource.options) : [];
  const defaultValue = stringsOrUndefined(contentSource.default);
  const queryValue = stringsOrUndefined(contentSource.query);
  const datasourceValue = stringsOrUndefined(contentSource.datasource);
  const datasourceTypeValue = stringsOrUndefined(contentSource.datasourceType);

  return {
    name: variable.name,
    label: stringsOrUndefined(variable.label) ?? variable.name,
    type: variable.type,
    description: stringsOrUndefined(variable.description),
    default:
      contentSource.type === 'custom' && !defaultValue && options.length > 0 ? options[0] : defaultValue,
    required: Boolean(variable.required),
    options: options.length > 0 ? options : undefined,
    datasource: datasourceValue,
    query: queryValue,
    multi: Boolean(contentSource.multi),
    includeAll: Boolean(contentSource.includeAll),
    datasourceType: datasourceTypeValue,
  };
}

function buildDashboardTemplateForUpload(
  dashboard: GrafanaDashboard,
  variables: EditableTemplateVariable[]
): GrafanaDashboard {
  const clonedDashboard = JSON.parse(JSON.stringify(dashboard)) as GrafanaDashboard;
  if (!clonedDashboard.templating) {
    clonedDashboard.templating = { list: [] };
  }

  const templatingList = clonedDashboard.templating.list ?? [];
  for (const editableVariable of variables) {
    const effectiveVariable = materializeEditableVariable(editableVariable);
    const existingIndex = templatingList.findIndex((item) => item.name === editableVariable.detected.name);
    const nextVariable = buildDashboardVariable(effectiveVariable, templatingList[existingIndex]);

    if (existingIndex === -1) {
      templatingList.push(nextVariable);
    } else {
      templatingList[existingIndex] = nextVariable;
    }
  }

  clonedDashboard.templating.list = templatingList;
  return clonedDashboard;
}

function buildDashboardVariable(definition: TemplateVariable, existing?: GrafanaVariable): GrafanaVariable {
  const normalizedOptions = normalizeOptions(definition.options);
  const defaultValue = definition.default ?? '';

  const base: GrafanaVariable = {
    ...(existing ?? {}),
    name: definition.name,
    label: definition.label || definition.name,
    type: definition.type,
    hide: existing?.hide ?? (definition.type === 'constant' ? 2 : 0),
    current: {
      value: definition.multi ? (defaultValue ? [defaultValue] : []) : defaultValue,
      text: definition.multi ? (defaultValue ? [defaultValue] : []) : defaultValue,
    },
  };

  switch (definition.type) {
    case 'textbox':
    case 'constant':
      base.query = defaultValue;
      break;

    case 'custom':
      base.options = normalizedOptions.map((option) => ({
        value: option,
        text: option,
        selected: option === defaultValue || (!defaultValue && option === normalizedOptions[0]),
      }));
      base.query = normalizedOptions.join(',');
      base.multi = Boolean(definition.multi);
      base.includeAll = Boolean(definition.includeAll);
      if (!defaultValue && normalizedOptions.length > 0) {
        base.current = {
          value: definition.multi ? [normalizedOptions[0]] : normalizedOptions[0],
          text: definition.multi ? [normalizedOptions[0]] : normalizedOptions[0],
        };
      }
      break;

    case 'query':
      base.query = definition.query ?? '';
      base.multi = Boolean(definition.multi);
      base.includeAll = Boolean(definition.includeAll);
      if (definition.datasource) {
        base.datasource = definition.datasource;
      }
      break;

    case 'datasource':
      base.query = definition.datasourceType ?? '';
      base.regex = existing?.regex ?? '';
      break;

    default:
      break;
  }

  return base;
}

function buildDatasourceTypeOptions(
  availableDatasourceTypes: GrafanaDatasourcePlugin[],
  requiredDatasources: RequiredDatasource[]
): Array<{ label: string; value: string }> {
  const options = new Map<string, string>();

  for (const datasourceType of availableDatasourceTypes) {
    options.set(datasourceType.id, `${datasourceType.name} (${datasourceType.id})`);
  }

  for (const requiredDatasource of requiredDatasources) {
    if (!options.has(requiredDatasource.type)) {
      options.set(requiredDatasource.type, requiredDatasource.type);
    }
  }

  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveDatasourceDisplayName(value: string, availableDatasourceTypes: GrafanaDatasourcePlugin[]): string {
  return availableDatasourceTypes.find((datasourceType) => datasourceType.id === value)?.name ?? value;
}

function parseCustomOptions(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((option) => option.trim())
    .filter(Boolean);
}

function normalizeOptions(options?: string[]): string[] {
  return (options ?? []).map((option) => option.trim()).filter(Boolean);
}

function stringsOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getVariableContentPreview(variable: TemplateVariable): string {
  if (variable.type === 'query' && variable.query) {
    return variable.query;
  }

  if (variable.type === 'custom' && variable.options?.length) {
    return variable.options.join(', ');
  }

  if (variable.type === 'datasource' && variable.datasourceType) {
    return variable.datasourceType;
  }

  if (variable.default?.trim()) {
    return variable.default;
  }

  return 'No detected content';
}

function getUploadErrorMessage(error: unknown): string {
  const fallback = 'Upload failed';
  const message = error instanceof Error ? error.message.trim() : '';

  if (!message || message === fallback) {
    return `${fallback}. If you updated the plugin recently, hard refresh the page with Ctrl+F5 and try again.`;
  }

  if (message.includes('already exists')) {
    return `${message} Publishing the same title again requires a new version or a different title.`;
  }

  if (message.includes('Editor role or higher is required')) {
    return 'Your current Grafana role cannot publish templates. Ask an Editor or Admin to publish it.';
  }

  return message;
}

function isTemplateVersionValid(version: string): boolean {
  return TEMPLATE_VERSION_PATTERN.test(version.trim());
}

function getVariableValidationError(variables: TemplateVariable[]): string | null {
  const seenNames = new Set<string>();

  for (const variable of variables) {
    const trimmedName = variable.name.trim();
    if (!trimmedName) {
      return 'Each variable must have a name before you publish the template.';
    }

    if (!/^[A-Za-z0-9_:-]+$/.test(trimmedName)) {
      return `Variable "${trimmedName}" contains unsupported characters. Use letters, digits, underscores, colons, or dashes.`;
    }

    if (seenNames.has(trimmedName)) {
      return `Variable "${trimmedName}" is duplicated. Variable names must be unique.`;
    }
    seenNames.add(trimmedName);

    if (variable.type === 'custom' && normalizeOptions(variable.options).length === 0) {
      return `Custom variable "${trimmedName}" needs at least one option.`;
    }
  }

  return null;
}

function getPublishValidationError(args: {
  title: string;
  shortDescription: string;
  version: string;
  variables: TemplateVariable[];
}): string | null {
  if (!args.title.trim()) {
    return 'Title is required.';
  }

  if (!args.shortDescription.trim()) {
    return 'Short description is required.';
  }

  if (!isTemplateVersionValid(args.version)) {
    return 'Version must use semantic versioning like 1.2.3.';
  }

  return getVariableValidationError(args.variables);
}
