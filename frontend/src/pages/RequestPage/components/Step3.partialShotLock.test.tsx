/**
 * claude 수정 (2026-11-05): Step3(O-layer 정보 탭) Partial Shot 잠금.
 *
 * 지난 회차를 포함해 O(OVL)가 한 번이라도 합의한 요청서는 편집 화면에서 Partial Shot 을 바꿀 수 없다
 * (서버 `partial_shot_locked`, MASTER 는 false). 잠기면 O/X 토글이 disabled 이고 잠금 안내가 보인다.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Step3 from './Step3';
import i18n from '../../../i18n';
import { INITIAL_DETAIL } from '../constants';
import { CellSelectionApi } from '../../../hooks/useCellSelection';

const NOTICE = i18n.t('request.partial_shot_locked_notice');

const noop = (): void => undefined;

const cellSel: CellSelectionApi = {
  isCellSelected: () => false,
  onCellMouseDown: noop,
  onCellMouseEnter: noop,
  onCellPaste: noop,
  clearCellSelection: noop,
  selectCells: noop,
  containerRef: React.createRef<HTMLDivElement>(),
  isDragging: false,
};

const renderStep3 = (partialShotLocked: boolean) => render(
  <Step3
    oayerRows={[]}
    oayerFilterSets={[]}
    setOayerFilterModalOpen={noop}
    oayerInfoTab="info"
    setOayerInfoTab={noop}
    oayerInfoLocked={false}
    detail={{ ...INITIAL_DETAIL, partial_shot: 'O' }}
    setDetail={noop}
    errors={{}}
    setErrors={noop}
    tbvtlvSdsSelected={[]}
    setTbvtlvSdsSelected={noop}
    tbvtlvNoteRows={[]}
    setTbvtlvNoteRows={noop}
    handleOayerSetAll={noop}
    handleOayerResetField={noop}
    handleOayerApplyFilter={noop}
    handleOayerChange={noop}
    cellSel={cellSel}
    GuideTourBadge={null}
    GuideBadge={() => null}
    stLocked={false}
    partialShotLocked={partialShotLocked}
  />,
);

const toggleButtons = (): HTMLButtonElement[] => ['O', 'X'].map(
  (val) => screen.getAllByRole('button', { name: val }).find((b) => b.classList.contains('map-type-btn')) as HTMLButtonElement,
);

describe('Step3 — Partial Shot 잠금', () => {
  it('O 합의 이력이 있으면(partialShotLocked) 토글이 잠기고 안내가 보인다', () => {
    renderStep3(true);
    toggleButtons().forEach((b) => expect(b.disabled).toBe(true));
    expect(screen.getByText(NOTICE, { exact: false })).toBeTruthy();
  });

  it('잠금이 아니면 토글을 누를 수 있고 안내가 없다', () => {
    renderStep3(false);
    toggleButtons().forEach((b) => expect(b.disabled).toBe(false));
    expect(screen.queryByText(NOTICE, { exact: false })).toBeNull();
  });
});
