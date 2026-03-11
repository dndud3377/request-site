import React from 'react';

interface FormSelectProps {
  label: string;
  name: string;
  value: string;
  options: readonly string[];
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  style?: React.CSSProperties;
  className?: string;
  visibility?: 'visible' | 'hidden';
}

const FormSelect: React.FC<FormSelectProps> = ({
  label,
  name,
  value,
  options,
  onChange,
  placeholder,
  required,
  error,
  style,
  className,
  visibility,
}) => (
  <div
    className={`form-group${className ? ` ${className}` : ''}`}
    style={{ ...style, ...(visibility ? { visibility } : {}) }}
  >
    <label className="form-label">
      {label}
      {required && <span className="required"> *</span>}
    </label>
    <select
      className={`form-control${error ? ' error' : ''}`}
      name={name}
      value={value}
      onChange={onChange}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
    {error && <span className="form-error">{error}</span>}
  </div>
);

export default FormSelect;
