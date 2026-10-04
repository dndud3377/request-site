import React from 'react';
import { render } from '@testing-library/react';
import AdiCdTargetsCell from './AdiCdTargetsCell';
import i18n from '../i18n';

const T = (partid: string, processId: string) => ({ partid_selection: partid, process_id: processId });
const texts = (el: Element, selector: string) =>
  Array.from(el.querySelectorAll(selector)).map((n) => n.textContent);

describe('AdiCdTargetsCell', () => {
  it('머리 줄에 조합법을 한 번만 쓰고, 2건 이상이면 건수 배지를 붙인다', () => {
    const { container } = render(
      <AdiCdTargetsCell combo="TLC" targets={[T('A', 'R1'), T('B', 'R1'), T('C', 'R1'), T('D', 'R1')]} />,
    );
    expect(texts(container, '.adi-targets-combo')).toEqual(['TLC']);
    const badge = container.querySelector('.adi-targets-count');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('4');
  });

  it('대상이 1건이면 배지는 숨기고, 같은 표 형태(머리 줄 + 조리법|제품 이름 표)는 그대로 쓴다', () => {
    const { container } = render(<AdiCdTargetsCell combo="TLC" targets={[T('A', 'R1')]} />);
    expect(container.querySelector('.adi-targets-count')).toBeNull();
    expect(texts(container, '.adi-targets-combo')).toEqual(['TLC']);
    expect(texts(container, '.adi-targets-process')).toEqual(['R1']);
    expect(texts(container, '.adi-targets-product')).toEqual(['A']);
  });

  it('조리법별 묶음에 조리법 칸과 제품 이름 칸을 입력 순서대로 그린다', () => {
    const { container } = render(
      <AdiCdTargetsCell combo="MLC" targets={[T('A', 'R1'), T('B', 'R1'), T('A', 'R2')]} />,
    );
    const groups = Array.from(container.querySelectorAll('.adi-targets-group'));
    expect(groups).toHaveLength(2);
    expect(texts(groups[0], '.adi-targets-process')).toEqual(['R1']);
    expect(texts(groups[0], '.adi-targets-product')).toEqual(['A', 'B']);
    expect(texts(groups[1], '.adi-targets-process')).toEqual(['R2']);
    expect(texts(groups[1], '.adi-targets-product')).toEqual(['A']);
  });

  it('표 머리 행에 조리법 / 제품 이름 두 칸을 그린다', () => {
    const { container } = render(<AdiCdTargetsCell combo="TLC" targets={[T('A', 'R1')]} />);
    expect(texts(container, '.adi-targets-th')).toEqual([i18n.t('request.process_id'), i18n.t('request.partid_selection')]);
  });

  it('조리법 칸은 그 묶음의 제품 수만큼 세로로 합치고, 묶음 첫 제품에만 구분선 표시를 붙인다', () => {
    const { container } = render(
      <AdiCdTargetsCell combo="MLC" targets={[T('A', 'R1'), T('B', 'R1'), T('C', 'R1'), T('D', 'R2')]} />,
    );
    const processes = Array.from(container.querySelectorAll<HTMLElement>('.adi-targets-process'));
    expect(processes.map((p) => p.style.gridRow)).toEqual(['span 3', 'span 1']);
    const starts = Array.from(container.querySelectorAll('.adi-targets-product'))
      .map((p) => p.classList.contains('is-group-start'));
    expect(starts).toEqual([true, false, false, true]);
  });

  it('button 안에 넣어도 되도록 div 없이 span 만 쓴다', () => {
    const { container } = render(<AdiCdTargetsCell combo="TLC" targets={[T('A', 'R1'), T('B', 'R2')]} />);
    expect(container.querySelector('div')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });
});
