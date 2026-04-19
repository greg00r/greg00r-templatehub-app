import { config, hasPermission } from '@grafana/runtime';
import type { MarketplaceAccess } from '../types';

export type MarketplaceOrgRole = 'Admin' | 'Editor' | 'Viewer';

const PLUGIN_ID = 'greg00r-templatehub-app';

export const MARKETPLACE_PERMISSION_READ = `${PLUGIN_ID}.templates:read`;
export const MARKETPLACE_PERMISSION_PUBLISH = `${PLUGIN_ID}.templates:publish`;
export const MARKETPLACE_PERMISSION_REVIEW = `${PLUGIN_ID}.templates:review`;
export const MARKETPLACE_PERMISSION_APPROVE = `${PLUGIN_ID}.templates:approve`;
export const MARKETPLACE_PERMISSION_DELETE = `${PLUGIN_ID}.templates:delete`;
export const MARKETPLACE_PERMISSION_INITIALIZE = `${PLUGIN_ID}.templates:initialize`;

export function normalizeOrgRole(role: string | undefined | null): MarketplaceOrgRole {
  const normalized = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (normalized === 'admin' || normalized === 'grafanaadmin' || normalized === 'serveradmin') {
    return 'Admin';
  }

  if (normalized === 'editor') {
    return 'Editor';
  }

  return 'Viewer';
}

export function getCurrentOrgRole(): MarketplaceOrgRole {
  return normalizeOrgRole(config.bootData?.user?.orgRole);
}

export function getFallbackMarketplaceAccess(role: string | undefined | null): MarketplaceAccess {
  const normalized = normalizeOrgRole(role);

  return {
    read: true,
    publish: normalized === 'Admin' || normalized === 'Editor',
    review: normalized === 'Admin',
    approve: normalized === 'Admin',
    delete: normalized === 'Admin',
    initialize: normalized === 'Admin',
    orgRole: normalized,
    source: 'basic-role-fallback',
    rbacAvailable: false,
  };
}

export function getCurrentFallbackMarketplaceAccess(): MarketplaceAccess {
  return getFallbackMarketplaceAccess(getCurrentOrgRole());
}

export function getFrontendPermissionMarketplaceAccess(): Partial<MarketplaceAccess> {
  return {
    read: hasPermission(MARKETPLACE_PERMISSION_READ),
    publish: hasPermission(MARKETPLACE_PERMISSION_PUBLISH),
    review: hasPermission(MARKETPLACE_PERMISSION_REVIEW),
    approve: hasPermission(MARKETPLACE_PERMISSION_APPROVE),
    delete: hasPermission(MARKETPLACE_PERMISSION_DELETE),
    initialize: hasPermission(MARKETPLACE_PERMISSION_INITIALIZE),
    rbacAvailable: true,
    source: 'frontend-permission-check',
  };
}

export function mergeMarketplaceAccess(base: MarketplaceAccess, override?: Partial<MarketplaceAccess>): MarketplaceAccess {
  if (!override) {
    return base;
  }

  return {
    read: override.read ?? base.read,
    publish: override.publish ?? base.publish,
    review: override.review ?? base.review,
    approve: override.approve ?? base.approve,
    delete: override.delete ?? base.delete,
    initialize: override.initialize ?? base.initialize,
    orgRole: override.orgRole ?? base.orgRole,
    source: override.source ?? base.source,
    rbacAvailable: override.rbacAvailable ?? base.rbacAvailable,
    rbacError: override.rbacError ?? base.rbacError,
  };
}

export function getInitialMarketplaceAccess(): MarketplaceAccess {
  const fallbackAccess = getCurrentFallbackMarketplaceAccess();
  const frontendPermissionAccess = getFrontendPermissionMarketplaceAccess();

  return {
    ...fallbackAccess,
    read: fallbackAccess.read || Boolean(frontendPermissionAccess.read),
    publish: fallbackAccess.publish || Boolean(frontendPermissionAccess.publish),
    review: fallbackAccess.review || Boolean(frontendPermissionAccess.review),
    approve: fallbackAccess.approve || Boolean(frontendPermissionAccess.approve),
    delete: fallbackAccess.delete || Boolean(frontendPermissionAccess.delete),
    initialize: fallbackAccess.initialize || Boolean(frontendPermissionAccess.initialize),
    rbacAvailable: fallbackAccess.rbacAvailable || Boolean(frontendPermissionAccess.rbacAvailable),
    source:
      fallbackAccess.source === 'basic-role-fallback' &&
      (frontendPermissionAccess.publish ||
        frontendPermissionAccess.review ||
        frontendPermissionAccess.approve ||
        frontendPermissionAccess.delete ||
        frontendPermissionAccess.initialize)
        ? 'frontend-permission+basic-role'
        : fallbackAccess.source,
  };
}

export function getCurrentUserDisplayName(): string {
  const currentUser = config.bootData?.user;

  if (currentUser?.name?.trim()) {
    return currentUser.name.trim();
  }

  if (currentUser?.login?.trim()) {
    return currentUser.login.trim();
  }

  if (currentUser?.email?.trim()) {
    return currentUser.email.trim();
  }

  return 'Current user';
}

export function canPublishTemplatesForRole(role: string | undefined | null): boolean {
  return getFallbackMarketplaceAccess(role).publish;
}

export function canCurrentUserPublishTemplates(): boolean {
  return getCurrentFallbackMarketplaceAccess().publish;
}

export function canApproveTemplatesForRole(role: string | undefined | null): boolean {
  return getFallbackMarketplaceAccess(role).approve;
}

export function canCurrentUserApproveTemplates(): boolean {
  return getCurrentFallbackMarketplaceAccess().approve;
}
