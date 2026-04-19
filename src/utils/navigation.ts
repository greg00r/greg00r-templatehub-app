export const PLUGIN_ROOT = '/a/greg00r-templatehub-app';

export type PluginRoute =
  | { type: 'gallery' }
  | { type: 'upload' }
  | { type: 'review' }
  | { type: 'template'; templateId: string };

export function normalizePath(pathname: string): string {
  if (!pathname) {
    return PLUGIN_ROOT;
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '');
  }

  return pathname;
}

export function buildPluginPath(route: PluginRoute): string {
  if (route.type === 'upload') {
    return `${PLUGIN_ROOT}/upload`;
  }

  if (route.type === 'review') {
    return `${PLUGIN_ROOT}/review`;
  }

  if (route.type === 'template') {
    return `${PLUGIN_ROOT}/template/${encodeURIComponent(route.templateId)}`;
  }

  return PLUGIN_ROOT;
}

export function getCurrentPluginRoute(pathname: string = window.location.pathname): PluginRoute {
  const normalizedPath = normalizePath(pathname);

  if (!normalizedPath.startsWith(PLUGIN_ROOT)) {
    return { type: 'gallery' };
  }

  const relativePath = normalizedPath.slice(PLUGIN_ROOT.length).replace(/^\/+/, '');

  if (!relativePath) {
    return { type: 'gallery' };
  }

  if (relativePath === 'upload') {
    return { type: 'upload' };
  }

  if (relativePath === 'review') {
    return { type: 'review' };
  }

  if (relativePath.startsWith('template/')) {
    const templateId = relativePath.slice('template/'.length);
    if (templateId) {
      return { type: 'template', templateId: decodeURIComponent(templateId) };
    }
  }

  return { type: 'gallery' };
}

export function navigateToPath(path: string) {
  window.location.assign(path);
}
