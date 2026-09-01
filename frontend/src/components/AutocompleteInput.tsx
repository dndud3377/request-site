import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

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
  hideErrorMessage?: boolean;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  disabled?: boolean;
  dropdownFontSize?: string;
  dropdownDirection?: 'up' | 'down';
  uppercase?: boolean;
  maxLength?: number;
  /** true면 콤마로 구분된 값을 체크박스 토글로 여러 개 선택할 수 있다(자유 입력은 그대로 유지). */
  multiSelect?: boolean;
  /** 값/옵션의 "동일 항목" 판정 기준을 바꾼다(예: 라벨 끝의 부가정보 제외). 기본은 문자열 그대로 비교. multiSelect 에서만 쓰인다. */
  multiSelectIdentity?: (label: string) => string;
  /** 다중 선택된 라벨 목록(원래 옵션 문자열)을 저장용 문자열로 합치는 방법. 기본은 ", " 로 이어붙임. multiSelect 에서만 쓰인다. */
  formatMultiValue?: (labels: string[]) => string;
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
  hideErrorMessage,
  style,
  inputStyle,
  disabled,
  dropdownFontSize = '0.9rem',
  dropdownDirection = 'down',
  uppercase,
  maxLength,
  multiSelect,
  multiSelectIdentity,
  formatMultiValue,
}: AutocompleteInputProps): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fixedPos, setFixedPos] = useState<{ bottom: number; left: number; width: number } | null>(null);

  const identityOf = multiSelectIdentity ?? ((s: string) => s);
  const joinMultiValue = formatMultiValue ?? ((labels: string[]) => labels.join(', '));
  const currentTags = multiSelect ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const selectedIdentities = currentTags.map(identityOf);
  // multiSelect 에서는 마지막 콤마 뒤 입력 중인 부분만으로 후보를 좁힌다(전체 값으로 필터링하면
  // 이미 선택된 항목들이 이어붙은 문자열이라 옵션과 매치되지 않는다).
  const filterQuery = multiSelect ? (value.split(',').pop() ?? '').trim() : value;
  const filtered = filterQuery
    ? options.filter((o) => o.toLowerCase().includes(filterQuery.toLowerCase()))
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

  const dropdownItems = filtered.map((opt) => {
    const checked = multiSelect && selectedIdentities.includes(identityOf(opt));
    const highlighted = multiSelect ? checked : opt === value;
    return (
      <li
        key={opt}
        onMouseDown={(e) => {
          e.preventDefault();
          if (multiSelect) {
            // 목록을 지웠다 다시 그리면 이 클릭이 문서까지 버블링되기 전에 클릭한 노드가 사라져
            // "바깥 클릭"으로 오인될 수 있다. stopPropagation 으로 그 상위 감지 자체를 막고,
            // 다중 선택이 끝날 때까지 드롭다운을 열어둔 채 체크만 토글한다.
            e.stopPropagation();
            const identities = [...selectedIdentities];
            const targetId = identityOf(opt);
            const i = identities.indexOf(targetId);
            if (i === -1) identities.push(targetId); else identities.splice(i, 1);
            const fullLabels = identities.map((id) => options.find((o) => identityOf(o) === id) ?? id);
            const next = joinMultiValue(fullLabels);
            onChange(next);
            onSelect?.(next);
            return;
          }
          onChange(opt);
          onSelect?.(opt);
          setOpen(false);
        }}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: dropdownFontSize,
          display: multiSelect ? 'flex' : undefined,
          alignItems: multiSelect ? 'center' : undefined,
          gap: multiSelect ? 8 : undefined,
          color: highlighted ? 'var(--accent)' : 'var(--text-primary)',
          fontWeight: highlighted ? 700 : 400,
          background: 'transparent',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {multiSelect && (
          <input type="checkbox" checked={!!checked} readOnly style={{ pointerEvents: 'none', margin: 0 }} />
        )}
        {opt}
      </li>
    );
  });

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
        placeholder={placeholder ?? t('common.input_or_select')}
        onChange={(e) => { if (!disabled) { onChange(uppercase ? e.target.value.toUpperCase() : e.target.value); setOpen(true); } }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onBlur={() => { if (onBlur) setTimeout(onBlur, 120); }}
        autoComplete="off"
        disabled={disabled}
        maxLength={maxLength}
        style={disabled ? { backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed', opacity: 0.6 } : inputStyle}
      />
      {error && !hideErrorMessage && <span className="form-error">{error}</span>}
      {renderDropdown()}
    </div>
  );
}
