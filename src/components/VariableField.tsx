import React, { useEffect, useMemo, useState } from 'react';
import { Field, Input, MultiSelect, Select } from '@grafana/ui';
import { getDataSources, resolveDatasourceQueryOptions } from '../api/grafana';
import type { GrafanaDataSource, TemplateVariable } from '../types';

interface Props {
  variable: TemplateVariable;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}

export function VariableField({ variable, value, onChange }: Props) {
  return (
    <Field
      label={variable.label || variable.name}
      description={variable.description}
      required={variable.required}
    >
      <VariableInput variable={variable} value={value} onChange={onChange} />
    </Field>
  );
}

function VariableInput({ variable, value, onChange }: Props) {
  switch (variable.type) {
    case 'textbox':
    case 'constant':
      return (
        <Input
          value={typeof value === 'string' ? value : value[0] ?? ''}
          placeholder={variable.default ?? ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );

    case 'custom':
      return <CustomVariableField variable={variable} value={value} onChange={onChange} />;

    case 'query':
      return <QueryVariableField variable={variable} value={value} onChange={onChange} />;

    case 'datasource':
      return <DatasourceVariableField variable={variable} value={value} onChange={onChange} />;

    default:
      return (
        <Input
          value={typeof value === 'string' ? value : value[0] ?? ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
  }
}

function CustomVariableField({ variable, value, onChange }: Props) {
  const options = (variable.options ?? []).map((option) => ({ label: option, value: option }));

  if (variable.multi) {
    const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

    return (
      <MultiSelect
        options={options}
        value={selectedValues.map((selected) => ({ label: selected, value: selected }))}
        onChange={(items) => onChange(items.map((item) => String(item.value)))}
        closeMenuOnSelect={false}
        placeholder={`Select ${variable.label || variable.name}`}
      />
    );
  }

  const selectedValue = typeof value === 'string' ? value : value[0];

  return (
    <Select
      options={options}
      value={selectedValue ? { label: selectedValue, value: selectedValue } : undefined}
      onChange={(item) => onChange(String(item.value ?? ''))}
      placeholder={variable.default || `Select ${variable.label || variable.name}`}
    />
  );
}

function QueryVariableField({ variable, value, onChange }: Props) {
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([]);

  useEffect(() => {
    const datasourceRef = variable.datasource || variable.datasourceType || '';
    if (!datasourceRef || !variable.query) {
      setOptions([]);
      return;
    }

    resolveDatasourceQueryOptions(datasourceRef, variable.query)
      .then((items) => {
        const mappedOptions = items.map((item) => ({ label: item, value: item }));
        setOptions(
          variable.includeAll
            ? [{ label: 'All', value: '$__all' }, ...mappedOptions]
            : mappedOptions
        );
      })
      .catch(() => setOptions([]));
  }, [variable.datasource, variable.datasourceType, variable.includeAll, variable.query]);

  if (variable.multi) {
    const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

    return (
      <MultiSelect
        options={options}
        value={selectedValues.map((selected) => ({ label: selected, value: selected }))}
        onChange={(items) => onChange(items.map((item) => String(item.value)))}
        closeMenuOnSelect={false}
        placeholder={`Select ${variable.label || variable.name}`}
      />
    );
  }

  const selectedValue = typeof value === 'string' ? value : value[0];

  return (
    <Select
      options={options}
      value={selectedValue ? { label: selectedValue, value: selectedValue } : undefined}
      onChange={(item) => {
        if (item && !Array.isArray(item)) {
          onChange(String(item.value ?? ''));
        }
      }}
      placeholder={variable.default || `Select ${variable.label || variable.name}`}
    />
  );
}

function DatasourceVariableField({ variable, value, onChange }: Props) {
  const [datasources, setDatasources] = useState<GrafanaDataSource[]>([]);

  useEffect(() => {
    getDataSources().then(setDatasources).catch(() => setDatasources([]));
  }, []);

  const options = useMemo(() => {
    return datasources
      .filter((datasource) => !variable.datasourceType || datasource.type === variable.datasourceType)
      .map((datasource) => ({
        label: `${datasource.name} (${datasource.type})`,
        value: datasource.uid,
      }));
  }, [datasources, variable.datasourceType]);

  const selectedValue = typeof value === 'string' ? value : value[0] ?? '';
  const selectedOption = options.find((option) => option.value === selectedValue);

  return (
    <Select
      options={options}
      value={selectedOption}
      onChange={(item) => onChange(String(item.value ?? ''))}
      placeholder={`Select ${variable.label || variable.name}`}
    />
  );
}
