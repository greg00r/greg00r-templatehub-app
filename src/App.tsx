import React from 'react';
import { AppRootProps } from '@grafana/data';
import { Gallery } from './pages/Gallery';
import { TemplateDetail } from './pages/TemplateDetail';
import { Upload } from './pages/Upload';
import type { AppPluginSettings } from './types';
import { getCurrentPluginRoute } from './utils/navigation';

export function App(_props: AppRootProps<AppPluginSettings>) {
  const route = getCurrentPluginRoute();

  if (route.type === 'template') {
    return <TemplateDetail templateId={route.templateId} />;
  }

  if (route.type === 'upload') {
    return <Upload />;
  }

  return <Gallery />;
}
