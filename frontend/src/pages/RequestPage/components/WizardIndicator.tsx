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
}

const WizardIndicator: React.FC<WizardIndicatorProps> = ({ currentStep, steps, onStepClick, stepTitle }) => (
  <div className="wizard-indicator">
    {steps.map((label, idx) => {
      const stepNum = idx + 1;
      const isDone = currentStep > stepNum;
      const isActive = currentStep === stepNum;
      // 현재 단계는 눌러도 갈 곳이 없으므로 클릭 대상에서 제외한다.
      const clickable = !!onStepClick && !isActive;
      return (
        <React.Fragment key={stepNum}>
          <div
            className={`wizard-step${clickable ? ' clickable' : ''}`}
            data-step={stepNum}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={clickable && stepTitle ? stepTitle(label) : undefined}
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
