import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  onBlur?: () => void;
  options: readonly string[];
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  disabled?: boolean;
  dropdownFontSize?: string;
  dropdownDirection?: 'up' | 'down';
}

export default function AutocompleteInput({
  value,
  onChange,
  onSelect,
  onBlur,
  options,
  placeholder,
  label,
  required,
  error,
  style,
  inputStyle,
  disabled,
  dropdownFontSize = '0.9rem',
  dropdownDirection = 'down',
}: AutocompleteInputProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fixedPos, setFixedPos] = useState<{ bottom: number; left: number; width: number } | null>(null);

  const filtered = value
    ? options.filter((o) => o.toLowerCase().includes(value.toLowerCase()))
    : options;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 'up' 방향일 때 portal 위치를 뷰포트 기준으로 계산 (overflow 컨테이너 잘림 방지)
  useEffect(() => {
    if (!open || dropdownDirection !== 'up') return;
    const update = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setFixedPos({ bottom: window.innerHeight - rect.top, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    return () => window.removeEventListener('scroll', update, true);
  }, [open, dropdownDirection]);

  const baseListStyle: React.CSSProperties = {
    zIndex: 9999,
    background: 'var(--bg-modal)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-lg)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    maxHeight: 220,
    overflowY: 'auto',
  };

  const dropdownItems = filtered.map((opt) => (
    <li
      key={opt}
      onMouseDown={(e) => {
        e.preventDefault();
        onChange(opt);
        onSelect?.(opt);
        setOpen(false);
      }}
      style={{
        padding: '8px 12px',
        cursor: 'pointer',
        fontSize: dropdownFontSize,
        color: opt === value ? 'var(--accent)' : 'var(--text-primary)',
        fontWeight: opt === value ? 700 : 400,
        background: 'transparent',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {opt}
    </li>
  ));

  const renderDropdown = () => {
    if (!open || filtered.length === 0) return null;

    if (dropdownDirection === 'up' && fixedPos) {
      return createPortal(
        <ul style={{ position: 'fixed', bottom: fixedPos.bottom, left: fixedPos.left, width: fixedPos.width, ...baseListStyle }}>
          {dropdownItems}
        </ul>,
        document.body
      );
    }

    return (
      <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, ...baseListStyle }}>
        {dropdownItems}
      </ul>
    );
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      {label && (
        <label className="form-label">
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <input
        type="text"
        className={`form-control${error ? ' error' : ''}`}
        value={value}
        placeholder={placeholder ?? '입력 또는 선택'}
        onChange={(e) => { if (!disabled) { onChange(e.target.value); setOpen(true); } }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onBlur={() => { if (onBlur) setTimeout(onBlur, 120); }}
        autoComplete="off"
        disabled={disabled}
        style={disabled ? { backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed', opacity: 0.6 } : inputStyle}
      />
      {error && <span className="form-error">{error}</span>}
      {renderDropdown()}
    </div>
  );
}
