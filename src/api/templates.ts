import { getBackendSrv } from '@grafana/runtime';
import type { GrafanaDashboard, MarketplaceAccess, Template, TemplateMetadata, TemplateStatus, TemplateVariables } from '../types';

const PLUGIN_ID = 'greg00r-templatehub-app';
const BASE_URL = `/api/plugins/${PLUGIN_ID}/resources`;

function withStatus(status: TemplateStatus = 'approved'): string {
  return status === 'pending' ? '?status=pending' : '';
}

export async function listTemplates(status: TemplateStatus = 'approved'): Promise<Template[]> {
  return getBackendSrv().get<Template[]>(`${BASE_URL}/templates${withStatus(status)}`);
}

export async function getMarketplaceAccess(): Promise<MarketplaceAccess> {
  return getBackendSrv().get<MarketplaceAccess>(`${BASE_URL}/access`);
}

export async function getTemplateMetadata(id: string, status: TemplateStatus = 'approved'): Promise<TemplateMetadata> {
  return getBackendSrv().get<TemplateMetadata>(`${BASE_URL}/templates/${id}${withStatus(status)}`);
}

export async function getTemplateJson(id: string, status: TemplateStatus = 'approved'): Promise<GrafanaDashboard> {
  return getBackendSrv().get<GrafanaDashboard>(`${BASE_URL}/templates/${id}/template${withStatus(status)}`);
}

export async function getTemplateVariables(id: string, status: TemplateStatus = 'approved'): Promise<TemplateVariables> {
  return getBackendSrv().get<TemplateVariables>(`${BASE_URL}/templates/${id}/variables${withStatus(status)}`);
}

export function getTemplateImageUrl(id: string, status: TemplateStatus = 'approved'): string {
  return `${BASE_URL}/templates/${id}/image${withStatus(status)}`;
}

export interface UploadTemplatePayload {
  templateJson: string;
  metadata: string;
  variablesJson: string;
  image?: File;
}

export async function uploadTemplate(payload: UploadTemplatePayload): Promise<TemplateMetadata> {
  const requestBody = await buildUploadRequestBody(payload);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/templates`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach the upload endpoint. Try a hard refresh (Ctrl+F5) and retry. Technical detail: ${reason}`
    );
  }

  const responseText = await response.text();
  const parsedBody = tryParseJson(responseText);

  if (!response.ok) {
    const messageFromBody = getErrorMessage(parsedBody);
    const fallbackMessage = responseText.trim() || response.statusText || `Upload failed with status ${response.status}`;
    throw new Error(messageFromBody || fallbackMessage);
  }

  return parsedBody as TemplateMetadata;
}

export async function approveTemplate(id: string): Promise<TemplateMetadata> {
  return getBackendSrv().post<TemplateMetadata>(`${BASE_URL}/templates/${id}/approve`, {});
}

export async function deleteTemplate(id: string, status: TemplateStatus = 'approved'): Promise<void> {
  await getBackendSrv().delete(`${BASE_URL}/templates/${id}${withStatus(status)}`);
}

function tryParseJson(value: string): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getErrorMessage(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && value !== null) {
    const errorValue = (value as Record<string, unknown>).error;
    if (typeof errorValue === 'string' && errorValue.trim()) {
      return errorValue;
    }

    const messageValue = (value as Record<string, unknown>).message;
    if (typeof messageValue === 'string' && messageValue.trim()) {
      return messageValue;
    }
  }

  return null;
}

async function buildUploadRequestBody(payload: UploadTemplatePayload) {
  const metadata = parseJsonObject<TemplateMetadata>(payload.metadata, 'metadata');
  const templateJson = parseJsonValue(payload.templateJson, 'templateJson');
  const variablesJson = parseJsonValue(payload.variablesJson, 'variablesJson');

  const requestBody: Record<string, unknown> = {
    templateJson,
    metadata,
    variablesJson,
  };

  if (payload.image) {
    const { base64, mimeType } = await fileToBase64(payload.image);
    requestBody.imageBase64 = base64;
    requestBody.imageMimeType = mimeType;
  }

  return requestBody;
}

function parseJsonValue(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${fieldName} payload: ${reason}`);
  }
}

function parseJsonObject<T>(value: string, fieldName: string): T {
  const parsed = parseJsonValue(value, fieldName);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  return parsed as T;
}

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  const [prefix, base64 = ''] = dataUrl.split(',', 2);
  const mimeMatch = prefix.match(/^data:([^;]+);base64$/i);

  return {
    base64,
    mimeType: mimeMatch?.[1] || file.type || 'application/octet-stream',
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read image "${file.name}"`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}
