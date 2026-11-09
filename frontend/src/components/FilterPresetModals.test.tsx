/**
 * 결재 현황 '나만의 필터' — 적용/표시 판정 헬퍼와 저장·관리 창.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 구현이 매 테스트마다 지워진다 → 콜백은 평범한 함수 + 기록 배열로 쓴다.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../i18n';
import {
  sanitizePresetValues, isPresetActive, hasAnyPresetFilter, buildPresetSummary,
  SavePresetModal, ManagePresetsModal, PresetFilterOptions,
} from './FilterPresetModals';
import { PersonalFilterPreset } from '../types';

const OPTIONS: PresetFilterOptions = {
  lines: ['라인1', '라인2', '라인3'],
  purposes: ['신규', '차용', '변경 감지'],
  mapPurposes: ['NEW', 'CLONE', '__NA__'],
};

const preset = (id: number, name: string, lines: string[], purposes: string[] = [], mapPurposes: string[] = []): PersonalFilterPreset => ({
  id, name, lines, purposes, map_purposes: mapPurposes, order: id,
});

const state = (lines: string[], purposes: string[] = [], mapPurposes: string[] = []) => ({
  lines: new Set(lines), purposes: new Set(purposes), mapPurposes: new Set(mapPurposes),
});

beforeAll(async () => { await i18n.changeLanguage('ko'); });

describe('헬퍼', () => {
  test('선택지에 없는 저장값은 걸러낸다', () => {
    expect(sanitizePresetValues(preset(1, 'A', ['라인1', '라인9'], ['없는목적'], ['CLONE']), OPTIONS))
      .toEqual({ lines: ['라인1'], purposes: [], map_purposes: ['CLONE'] });
  });

  test('3종이 정확히 같을 때만 적용 중이다(순서 무관, 하나라도 더 걸리면 아님)', () => {
    const p = preset(1, 'A', ['라인1', '라인2'], ['신규']);
    expect(isPresetActive(p, OPTIONS, state(['라인2', '라인1'], ['신규']))).toBe(true);
    expect(isPresetActive(p, OPTIONS, state(['라인1', '라인2'], ['신규'], ['NEW']))).toBe(false);
    expect(isPresetActive(p, OPTIONS, state(['라인1'], ['신규']))).toBe(false);
  });

  test('없는 값은 무시하고 판정하며, 유효값이 하나도 없으면 적용 중으로 보지 않는다', () => {
    expect(isPresetActive(preset(1, 'A', ['라인1', '라인9']), OPTIONS, state(['라인1']))).toBe(true);
    expect(isPresetActive(preset(2, 'B', ['라인9']), OPTIONS, state([]))).toBe(false);
  });

  test('3종 중 하나라도 걸려 있어야 저장할 수 있다', () => {
    expect(hasAnyPresetFilter(state([]))).toBe(false);
    expect(hasAnyPresetFilter(state([], [], ['NEW']))).toBe(true);
  });

  test('요약: 빈 항목은 전체, 없는 값에는 표시를 붙이고 MAP 값은 라벨 함수로 바꾼다', () => {
    const summary = buildPresetSummary(preset(1, 'A', ['라인1', '라인9'], [], ['__NA__']), OPTIONS, {
      line: '라인', purpose: '목적', map: 'MAP 목적', all: '전체', missing: '(없는 값)',
      mapValue: (v) => (v === '__NA__' ? '해당없음' : v),
    });
    expect(summary).toBe('라인 라인1, 라인9 (없는 값) · 목적 전체 · MAP 목적 해당없음');
  });
});

describe('저장 창', () => {
  test('빈 이름·중복 이름은 저장하지 않고 안내한다', () => {
    const saved: string[] = [];
    render(
      <SavePresetModal
        isOpen
        onClose={() => {}}
        presets={[preset(1, '기존', ['라인1'])]}
        summary="라인 라인2 · 목적 전체 · MAP 목적 전체"
        onSave={async (name) => { saved.push(name); return true; }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByText('이름을 입력하세요.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('필터 이름'), { target: { value: ' 기존 ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByText('같은 이름의 필터가 이미 있습니다.')).toBeTruthy();
    expect(saved).toEqual([]);
  });

  test('정상 이름은 앞뒤 공백을 지워 저장하고, 성공하면 창을 닫는다', async () => {
    const saved: string[] = [];
    let closed = 0;
    render(
      <SavePresetModal
        isOpen
        onClose={() => { closed += 1; }}
        presets={[]}
        summary=""
        onSave={async (name) => { saved.push(name); return true; }}
      />,
    );
    fireEvent.change(screen.getByLabelText('필터 이름'), { target: { value: '  라인3 MAP  ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(closed).toBe(1));
    expect(saved).toEqual(['라인3 MAP']);
  });
});

describe('관리 창', () => {
  const renderManage = (calls: string[], canOverwrite = true) => render(
    <ManagePresetsModal
      isOpen
      onClose={() => {}}
      presets={[preset(1, 'A', ['라인1']), preset(2, 'B', ['라인2'])]}
      summaryOf={(p) => `요약-${p.name}`}
      canOverwrite={canOverwrite}
      onRename={async (id, name) => { calls.push(`rename:${id}:${name}`); return true; }}
      onOverwrite={(id) => { calls.push(`overwrite:${id}`); }}
      onMove={(id, dir) => { calls.push(`move:${id}:${dir}`); }}
      onDelete={async (id) => { calls.push(`delete:${id}`); }}
    />,
  );

  test('맨 위는 위로, 맨 아래는 아래로 버튼이 꺼져 있고 순서 변경을 호출한다', () => {
    const calls: string[] = [];
    renderManage(calls);
    const ups = screen.getAllByRole('button', { name: '위로' }) as HTMLButtonElement[];
    const downs = screen.getAllByRole('button', { name: '아래로' }) as HTMLButtonElement[];
    expect(ups[0].disabled).toBe(true);
    expect(downs[1].disabled).toBe(true);
    fireEvent.click(ups[1]);
    expect(calls).toEqual(['move:2:-1']);
  });

  test('이름은 칸을 벗어날 때 저장하고, 다른 필터와 같은 이름이면 저장하지 않는다', () => {
    const calls: string[] = [];
    renderManage(calls);
    const inputs = screen.getAllByLabelText('필터 이름');
    fireEvent.change(inputs[0], { target: { value: 'B' } });
    fireEvent.blur(inputs[0]);
    expect(screen.getByText('같은 이름의 필터가 이미 있습니다.')).toBeTruthy();
    expect((inputs[0] as HTMLInputElement).value).toBe('A');
    fireEvent.change(inputs[0], { target: { value: 'A2' } });
    fireEvent.blur(inputs[0]);
    expect(calls).toEqual(['rename:1:A2']);
  });

  test('걸린 필터가 없으면 덮어쓰기를 막는다', () => {
    renderManage([], false);
    const btns = screen.getAllByRole('button', { name: '현재 필터로 덮어쓰기' }) as HTMLButtonElement[];
    expect(btns.every((b) => b.disabled)).toBe(true);
  });

  test('삭제는 확인 창을 거친다', async () => {
    const calls: string[] = [];
    renderManage(calls);
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[1]);
    expect(calls).toEqual([]);
    expect(screen.getByText(/'B' 필터를 삭제할까요\?/)).toBeTruthy();
    const deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(calls).toEqual(['delete:2']));
  });
});
