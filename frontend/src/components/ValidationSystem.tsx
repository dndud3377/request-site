import React from 'react';
import { useTranslation } from 'react-i18next';
import { ValidationSystemValue } from '../types';
import { VS_TARGET, VS_NONTARGET } from '../pages/RequestPage/constants';

/**
 * Validation System 값 → i18n 라벨.
 * 작성·상세보기·결재 세 화면이 같은 문구를 쓰도록 한 곳에 모은다.
 */
export const useValidationSystemLabel = (): ((v: ValidationSystemValue) => string) => {
  const { t } = useTranslation();
  return (v: ValidationSystemValue): string =>
    v === VS_TARGET ? t('request.validation_system_target')
      : v === VS_NONTARGET ? t('request.validation_system_nontarget')
        : t('request.validation_system_na');
};

/** 읽기 전용 표시 chip. 문서 상태 badge(.badge-*)와 같은 관용구를 따른다. */
export const ValidationSystemBadge: React.FC<{ value: ValidationSystemValue }> = ({ value }) => {
  const label = useValidationSystemLabel();
  return <span className={`vs-badge vs-badge-${value}`}>{label(value)}</span>;
};

interface ValidationSystemToggleProps {
  value: ValidationSystemValue;
  /** 판정 키워드가 없어 대상/비대상을 고를 수 없는 문서(해당없음) */
  notApplicable?: boolean;
  /** 수정 창이 닫혀 값을 바꿀 수 없는 상태 */
  disabled?: boolean;
  onChange: (value: ValidationSystemValue) => void;
}

/**
 * 대상/비대상 2버튼 토글.
 * 선택된 쪽만 의미색으로 채워, 흰 배경 위에서도 어느 값이 선택됐는지 확실히 읽히게 한다.
 * 미선택('')이면 양쪽 다 채워지지 않아 "아직 고르지 않았다"가 그대로 보인다
 * — 값이 VS_TARGET/VS_NONTARGET 둘 중 하나와만 일치하므로 별도 분기가 필요 없다.
 */
export const ValidationSystemToggle: React.FC<ValidationSystemToggleProps> = ({
  value,
  notApplicable = false,
  disabled = false,
  onChange,
}) => {
  const label = useValidationSystemLabel();
  const locked = notApplicable || disabled;
  return (
    <span className={`vs-toggle${locked ? ' vs-toggle-locked' : ''}`}>
      {([VS_TARGET, VS_NONTARGET] as const).map((opt) => {
        const active = !notApplicable && value === opt;
        return (
          <button
            key={opt}
            type="button"
            disabled={locked}
            onClick={() => onChange(opt)}
            className={`vs-toggle-btn${active ? ` vs-toggle-active-${opt}` : ''}`}
          >
            {label(opt)}
          </button>
        );
      })}
    </span>
  );
};
