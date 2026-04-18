import {
  detectRequiredDatasources,
  extractTemplateVariablesFromDashboard,
} from './templateIntrospection';

describe('templateIntrospection', () => {
  it('detects datasource types from a dashboard model', () => {
    const dashboard = {
      panels: [
        {
          datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' },
        },
        {
          datasource: { type: 'loki', uid: '${DS_LOKI}' },
        },
      ],
    };

    expect(detectRequiredDatasources(dashboard as never)).toEqual([
      { type: 'prometheus', name: 'prometheus' },
      { type: 'loki', name: 'loki' },
    ]);
  });

  it('extracts template variable definitions from Grafana templating', () => {
    const dashboard = {
      templating: {
        list: [
          {
            name: 'cluster',
            label: 'Cluster',
            type: 'textbox',
            current: { value: 'production', text: 'production' },
          },
          {
            name: 'namespace',
            label: 'Namespace',
            type: 'query',
            datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' },
            query: 'label_values(kube_namespace_labels, namespace)',
            multi: true,
            includeAll: true,
            current: { value: '$__all', text: 'All' },
          },
        ],
      },
    };

    expect(extractTemplateVariablesFromDashboard(dashboard as never)).toEqual([
      {
        name: 'cluster',
        label: 'Cluster',
        type: 'textbox',
        description: '',
        default: 'production',
        required: false,
        options: undefined,
        datasource: undefined,
        datasourceType: undefined,
        query: '',
        multi: false,
        includeAll: false,
      },
      {
        name: 'namespace',
        label: 'Namespace',
        type: 'query',
        description: '',
        default: '$__all',
        required: false,
        options: undefined,
        datasource: '${DS_PROMETHEUS}',
        datasourceType: 'prometheus',
        query: 'label_values(kube_namespace_labels, namespace)',
        multi: true,
        includeAll: true,
      },
    ]);
  });
});
