/**
 * 결재 상세 — 예외 구역 칩에 '합의자 미지정 사유'를 함께 보여주고, 재상신으로 사유가 바뀌면
 * 빨간 테두리·'이력 확인'(변경 전/후, 이력 조회에서는 회차별)에 반영되는지 검증한다.
 *
 * 사유는 detail.sales_agreer_none_reason 에 저장되며 이력 스냅샷(history[].detail)에도 들어간다.
 * 칩 표시값과 이력 모달 값은 같은 함수(buildEaValue)로 만들어지므로 사유가 회차별로 비교된다.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

const MAP_TAB_IDX = 1;
const CHIP_LABEL = i18n.t('request.ea_change');
const reasonPart = (reason: string) => i18n.t('request.sales_agreer_none_reason_suffix', { reason });
const chipText = (value: string, reason?: string) =>
  i18n.t('request.change_prefix', { value: '변경 있음' })
  + i18n.t('request.value_suffix_mm', { value })
  + (reason ? reasonPart(reason) : '');
/** 모달(포털) 안 값 칸의 텍스트들 — 숫자 강조 span 이 없어 한 노드로 잡힌다. */
const modalTexts = (): string[] =>
  Array.from(document.querySelectorAll('td')).map((td) => td.textContent ?? '');

const baseDetail = {
  request_purpose: '신규', map_type: 'NEW', map_change: '변경 없음',
  ea_change: '변경 있음', ea_value: '350', only_prodc: 'No',
};

const makeDoc = (detail: Record<string, unknown>, history: Record<string, unknown>[] = []): RequestDocument => ({
  id: 1,
  title: 'ea-reason-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { ...baseDetail, ...detail }, history }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-09-21T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
  submitted_at: '2026-10-05T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const snap = (detail: Record<string, unknown>, timestamp: string) => ({
  detail: { ...baseDetail, ...detail }, jayerRows: [], oayerRows: [], bbRows: [], timestamp,
});

const Harness: React.FC<{ doc: RequestDocument; historyMode?: boolean }> = ({ doc, historyMode }) => {
  const [pageIdx, setPageIdx] = useState(MAP_TAB_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} historyMode={historyMode} />;
};

/** 예외 구역 칩(라벨을 가진 div)을 돌려준다. */
const eaChip = (): HTMLElement => screen.getByText(CHIP_LABEL).parentElement as HTMLElement;
const histBtn = (chip: HTMLElement) => within(chip).queryByText(i18n.t('request.history_check_btn'));

describe('예외 구역 칩 — 합의자 미지정 사유 표시와 변경 이력', () => {
  it('사유가 있으면 값 뒤에 함께 보인다', () => {
    render(<Harness doc={makeDoc({ sales_agreer_none_reason: 'XXX' })} />);
    expect(eaChip().textContent).toContain(chipText('350', 'XXX'));
  });

  it('사유가 없으면 종전 문구 그대로다', () => {
    render(<Harness doc={makeDoc({ sales_agreer_none_reason: '' })} />);
    const chip = eaChip();
    expect(chip.textContent).toContain(chipText('350'));
    expect(chip.textContent).not.toContain(reasonPart(''));
  });

  it("'변경 없음'이면 잔여 사유가 있어도 보이지 않는다", () => {
    render(<Harness doc={makeDoc({ ea_change: '변경 없음', ea_value: '300', sales_agreer_none_reason: 'XXX' })} />);
    expect(eaChip().textContent).not.toContain('XXX');
  });

  it('재상신으로 사유만 바뀌어도 빨간 테두리·이력 확인이 뜨고 모달에 변경 전/후가 보인다', () => {
    const doc = makeDoc(
      { sales_agreer_none_reason: 'XXXX' },
      [snap({ sales_agreer_none_reason: 'XXX' }, '2026-10-01T00:00:00Z')],
    );
    render(<Harness doc={doc} />);
    const chip = eaChip();
    expect(chip.style.border).toContain('2px solid');
    fireEvent.click(histBtn(chip) as HTMLElement);
    expect(modalTexts().some((v) => v.includes(chipText('350', 'XXX')))).toBe(true);
    expect(modalTexts().some((v) => v.includes(chipText('350', 'XXXX')))).toBe(true);
  });

  it('이력 조회 모드: 회차별 사유가 모두 보이고 바뀐 회차에 변경 표시가 붙는다', () => {
    const doc = makeDoc(
      { sales_agreer_none_reason: 'XXXX' },
      [
        snap({ sales_agreer_none_reason: 'XXX' }, '2026-10-01T00:00:00Z'),
        snap({ sales_agreer_none_reason: 'XXX' }, '2026-10-02T00:00:00Z'),
      ],
    );
    render(<Harness doc={doc} historyMode />);
    fireEvent.click(histBtn(eaChip()) as HTMLElement);
    // 값 칸(td)만 모은다 — 1·2회차 XXX, 현재 XXXX. 변경 표시는 XXX→XXXX 로 바뀐 현재 회차 한 곳뿐이다.
    const values = modalTexts().filter((v) => v.includes(reasonPart('')));
    expect(values.filter((v) => v.includes(chipText('350', 'XXXX')))).toHaveLength(1);
    expect(values.filter((v) => v.includes(chipText('350', 'XXX')) && !v.includes('XXXX'))).toHaveLength(2);
    const changedMarks = Array.from(document.querySelectorAll('td span'))
      .filter((el) => el.textContent === i18n.t('request.changed_label'));
    expect(changedMarks).toHaveLength(1);
  });

  it('사유가 그대로면 변경 표시가 없다', () => {
    const doc = makeDoc(
      { sales_agreer_none_reason: 'XXX' },
      [snap({ sales_agreer_none_reason: 'XXX' }, '2026-10-01T00:00:00Z')],
    );
    render(<Harness doc={doc} />);
    expect(histBtn(eaChip())).toBeNull();
  });

  it('사유 기능 이전 스냅샷(필드 없음)과 현재 빈 사유는 거짓 변경으로 잡히지 않는다', () => {
    const legacy = snap({}, '2026-10-01T00:00:00Z');
    delete (legacy.detail as Record<string, unknown>).sales_agreer_none_reason;
    const doc = makeDoc({ sales_agreer_none_reason: '' }, [legacy]);
    render(<Harness doc={doc} />);
    expect(histBtn(eaChip())).toBeNull();
  });
});
