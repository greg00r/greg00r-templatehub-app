// ─── Plugin Settings ────────────────────────────────────────────────────────

export type StorageBackend = 'local' | 'external';
export type ExternalAuthType = 'none' | 'bearer' | 'basic';

export interface AppPluginSettings {
  storageBackend: StorageBackend;
  localPath?: string;
  externalUrl?: string;
  externalAuthType?: ExternalAuthType;
  externalAuthUsername?: string; // stored in jsonData (non-secret)
}

export interface AppPluginSecureSettings {
  externalAuthToken?: string;
  externalAuthPassword?: string;
}

// ─── Template Metadata ──────────────────────────────────────────────────────

export interface RequiredDatasource {
  type: string;
  name: string;
}

export interface TemplateMetadata {
  id: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  tags: string[];
  requiredDatasources: RequiredDatasource[];
  author: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Template Variables ──────────────────────────────────────────────────────

export type VariableType = 'textbox' | 'custom' | 'query' | 'constant' | 'datasource';

export interface TemplateVariable {
  name: string;
  label: string;
  type: VariableType;
  description?: string;
  default?: string;
  required?: boolean;
  // For custom type
  options?: string[];
  // For query type
  datasource?: string;
  query?: string;
  multi?: boolean;
  includeAll?: boolean;
  // For datasource type
  datasourceType?: string;
}

export interface TemplateVariables {
  variables: TemplateVariable[];
}

// ─── Full Template ───────────────────────────────────────────────────────────

export interface Template {
  metadata: TemplateMetadata;
  imageUrl?: string;
}

// ─── Grafana Dashboard Model ─────────────────────────────────────────────────

export interface GrafanaDashboard {
  id?: number | null;
  uid?: string;
  title: string;
  tags?: string[];
  templating?: {
    list: GrafanaVariable[];
  };
  panels?: unknown[];
  schemaVersion?: number;
  version?: number;
  [key: string]: unknown;
}

export interface GrafanaVariable {
  name: string;
  type: string;
  label?: string;
  current?: {
    value: string | string[];
    text: string | string[];
  };
  options?: Array<{ value: string; text: string; selected?: boolean }>;
  query?: string;
  datasource?: string | {
    type?: string;
    uid?: string;
    name?: string;
  };
  multi?: boolean;
  includeAll?: boolean;
  [key: string]: unknown;
}

// ─── Import Form ─────────────────────────────────────────────────────────────

export interface DatasourceMapping {
  templateUid: string;
  templateType: string;
  localUid: string;
}

export interface ImportFormValues {
  dashboardName: string;
  folderUid: string;
  variables: Record<string, string | string[]>;
  datasourceMappings: DatasourceMapping[];
}

// ─── Grafana API Types ───────────────────────────────────────────────────────

export interface GrafanaFolder {
  id: number;
  uid: string;
  title: string;
}

export interface GrafanaDataSource {
  id: number;
  uid: string;
  name: string;
  type: string;
  isDefault?: boolean;
}
