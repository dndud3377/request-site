import React from 'react';
import { render } from '@testing-library/react';
import AdiCdTargetsCell from './AdiCdTargetsCell';
import '../i18n';

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

  it('대상이 1건이면 배지는 숨기고, 같은 2줄 형태(머리 + 조리법 묶음)는 그대로 쓴다', () => {
    const { container } = render(<AdiCdTargetsCell combo="TLC" targets={[T('A', 'R1')]} />);
    expect(container.querySelector('.adi-targets-count')).toBeNull();
    expect(texts(container, '.adi-targets-combo')).toEqual(['TLC']);
    expect(texts(container, '.adi-targets-process')).toEqual(['R1']);
    expect(texts(container, '.adi-targets-product')).toEqual(['A']);
  });

  it('조리법별 묶음 줄에 조리법 태그와 제품 칩을 입력 순서대로 그린다', () => {
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

  it('button 안에 넣어도 되도록 div 없이 span 만 쓴다', () => {
    const { container } = render(<AdiCdTargetsCell combo="TLC" targets={[T('A', 'R1'), T('B', 'R2')]} />);
    expect(container.querySelector('div')).toBeNull();
  });
});
