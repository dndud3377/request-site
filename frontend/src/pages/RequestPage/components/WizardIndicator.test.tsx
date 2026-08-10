import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import WizardIndicator from './WizardIndicator';

// 의뢰서 위저드의 5단계 라벨(실제 사용 순서와 동일).
const STEPS = ['의뢰 상세', 'MAP 정보', 'J-ayer 정보', 'O-ayer 정보', 'Backbone'];

const steps = (c: HTMLElement) => Array.from(c.querySelectorAll('.wizard-step')) as HTMLElement[];

describe('WizardIndicator', () => {
  describe('onStepClick 미지정 (기존 표시 전용 동작)', () => {
    it('clickable 클래스·role·tabIndex 를 붙이지 않는다', () => {
      const { container } = render(<WizardIndicator currentStep={3} steps={STEPS} />);
      const all = steps(container);
      expect(all).toHaveLength(5);
      all.forEach((el) => {
        expect(el.className).not.toContain('clickable');
        expect(el.getAttribute('role')).toBeNull();
        expect(el.getAttribute('tabindex')).toBeNull();
        expect(el.getAttribute('title')).toBeNull();
      });
    });

    it('클릭해도 아무 일도 일어나지 않는다', () => {
      const { container } = render(<WizardIndicator currentStep={3} steps={STEPS} />);
      // 예외 없이 지나가면 성공 — 핸들러가 없으므로 호출 대상 자체가 없다.
      expect(() => fireEvent.click(steps(container)[0])).not.toThrow();
    });
  });

  describe('onStepClick 지정', () => {
    it('현재 단계만 클릭 대상에서 제외한다', () => {
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={jest.fn()} />
      );
      const all = steps(container);
      // 3번째(index 2)가 현재 단계다.
      const clickable = all.map((el) => el.className.includes('clickable'));
      expect(clickable).toEqual([true, true, false, true, true]);
      expect(all[2].getAttribute('role')).toBeNull();
      expect(all[2].getAttribute('tabindex')).toBeNull();
      expect(all[0].getAttribute('role')).toBe('button');
      expect(all[0].getAttribute('tabindex')).toBe('0');
    });

    it('이전 단계를 클릭하면 그 단계 번호로 호출한다', () => {
      const onStepClick = jest.fn();
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={onStepClick} />
      );
      fireEvent.click(steps(container)[0]);
      expect(onStepClick).toHaveBeenCalledTimes(1);
      expect(onStepClick).toHaveBeenCalledWith(1);
    });

    it('이후 단계를 클릭하면 그 단계 번호로 호출한다 (이동 가부는 호출자가 판정)', () => {
      const onStepClick = jest.fn();
      const { container } = render(
        <WizardIndicator currentStep={1} steps={STEPS} onStepClick={onStepClick} />
      );
      fireEvent.click(steps(container)[4]);
      expect(onStepClick).toHaveBeenCalledWith(5);
    });

    it('현재 단계를 클릭하면 호출하지 않는다', () => {
      const onStepClick = jest.fn();
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={onStepClick} />
      );
      fireEvent.click(steps(container)[2]);
      expect(onStepClick).not.toHaveBeenCalled();
    });

    it('Enter·Space 키로도 이동한다', () => {
      const onStepClick = jest.fn();
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={onStepClick} />
      );
      fireEvent.keyDown(steps(container)[0], { key: 'Enter' });
      fireEvent.keyDown(steps(container)[3], { key: ' ' });
      expect(onStepClick.mock.calls).toEqual([[1], [4]]);
    });

    it('그 밖의 키에는 반응하지 않는다', () => {
      const onStepClick = jest.fn();
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={onStepClick} />
      );
      fireEvent.keyDown(steps(container)[0], { key: 'Tab' });
      fireEvent.keyDown(steps(container)[0], { key: 'a' });
      expect(onStepClick).not.toHaveBeenCalled();
    });
  });

  describe('stepTitle 툴팁', () => {
    it('클릭 가능한 단계에만 라벨로 만든 title 을 붙인다', () => {
      const { container } = render(
        <WizardIndicator
          currentStep={3}
          steps={STEPS}
          onStepClick={jest.fn()}
          stepTitle={(label) => `${label} 단계로 이동`}
        />
      );
      const all = steps(container);
      expect(all[0].getAttribute('title')).toBe('의뢰 상세 단계로 이동');
      expect(all[4].getAttribute('title')).toBe('Backbone 단계로 이동');
      // 현재 단계는 클릭 대상이 아니므로 툴팁도 없다.
      expect(all[2].getAttribute('title')).toBeNull();
    });

    it('stepTitle 이 없으면 title 을 붙이지 않는다', () => {
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={jest.fn()} />
      );
      steps(container).forEach((el) => expect(el.getAttribute('title')).toBeNull());
    });
  });

  describe('완료·현재 표시 (기존 동작 회귀)', () => {
    it('지나온 단계는 done(✓), 현재 단계는 active 로 표시한다', () => {
      const { container } = render(
        <WizardIndicator currentStep={3} steps={STEPS} onStepClick={jest.fn()} />
      );
      const circles = Array.from(container.querySelectorAll('.wizard-step-circle')) as HTMLElement[];
      expect(circles.map((c) => c.textContent)).toEqual(['✓', '✓', '3', '4', '5']);
      expect(circles[1].className).toContain('done');
      expect(circles[2].className).toContain('active');
      expect(circles[3].className).not.toContain('done');
      expect(circles[3].className).not.toContain('active');
    });
  });
});
