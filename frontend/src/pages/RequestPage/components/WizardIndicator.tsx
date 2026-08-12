import React from 'react';

interface WizardIndicatorProps {
  currentStep: number;
  steps: string[];
  /**
   * 단계 원/라벨 클릭 시 호출된다. 미지정이면 클릭·키보드 조작이 모두 비활성화되어
   * 기존(표시 전용) 동작 그대로다 — 이동 가부 판정은 전적으로 호출자 몫이다.
   */
  onStepClick?: (step: number) => void;
  /** 클릭 가능한 단계에 붙일 툴팁 문구를 만든다(i18n 은 호출자가 처리). */
  stepTitle?: (label: string) => string;
  /**
   * 이 의뢰서에서 아예 들어갈 수 없는 단계 번호들(예: Only MAP 의 J-ayer·O-ayer·Backbone).
   * 흐리게 표시하고 클릭·키보드 이동을 막는다 — 전체 흐름 중 위치는 계속 보이도록 숨기지는 않는다.
   */
  disabledSteps?: number[];
  /** 잠긴 단계에 붙일 툴팁 문구(i18n 은 호출자가 처리). */
  disabledStepTitle?: (label: string) => string;
}

const WizardIndicator: React.FC<WizardIndicatorProps> = ({
  currentStep, steps, onStepClick, stepTitle, disabledSteps = [], disabledStepTitle,
}) => (
  <div className="wizard-indicator">
    {steps.map((label, idx) => {
      const stepNum = idx + 1;
      const isDisabled = disabledSteps.includes(stepNum);
      // 잠긴 단계는 지나온 단계가 아니므로 완료(✓) 표시도 하지 않는다.
      const isDone = currentStep > stepNum && !isDisabled;
      const isActive = currentStep === stepNum;
      // 현재 단계는 눌러도 갈 곳이 없으므로 클릭 대상에서 제외한다.
      const clickable = !!onStepClick && !isActive && !isDisabled;
      return (
        <React.Fragment key={stepNum}>
          <div
            className={`wizard-step${clickable ? ' clickable' : ''}${isDisabled ? ' disabled' : ''}`}
            data-step={stepNum}
            aria-disabled={isDisabled || undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={
              isDisabled
                ? (disabledStepTitle ? disabledStepTitle(label) : undefined)
                : (clickable && stepTitle ? stepTitle(label) : undefined)
            }
            onClick={clickable ? () => onStepClick(stepNum) : undefined}
            onKeyDown={clickable ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onStepClick(stepNum);
              }
            } : undefined}
          >
            <div className={`wizard-step-circle${isDone ? ' done' : isActive ? ' active' : ''}`}>
              {isDone ? '✓' : stepNum}
            </div>
            <span className={`wizard-step-label${isDone ? ' done' : isActive ? ' active' : ''}`}>
              {label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`wizard-connector${isDone ? ' done' : ''}`} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

export default WizardIndicator;
