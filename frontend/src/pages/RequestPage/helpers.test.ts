import { autoValidationSystem, isValidationKeywordRow, isValidationTarget, computeLayerMerge, MergeComparableRow } from './helpers';
import { VS_NA, VS_TARGET } from './constants';

describe('isValidationKeywordRow', () => {
  it('pp 가 판정 키워드를 포함하면 true', () => {
    expect(isValidationKeywordRow('PLEL')).toBe(true);
    expect(isValidationKeywordRow('xx-plel-01')).toBe(true);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isValidationKeywordRow('PlEl')).toBe(true);
  });

  it('키워드가 없거나 값이 비어 있으면 false', () => {
    expect(isValidationKeywordRow('ABC')).toBe(false);
    expect(isValidationKeywordRow('')).toBe(false);
    expect(isValidationKeywordRow(undefined)).toBe(false);
  });
});

describe('isValidationTarget', () => {
  it('활성 행 중 하나라도 키워드를 포함하면 대상', () => {
    expect(isValidationTarget([{ pp: 'ABC' }, { pp: 'PLEL' }])).toBe(true);
  });

  it('비활성 행은 판정에서 제외한다', () => {
    expect(isValidationTarget([{ pp: 'PLEL', disabled: true }])).toBe(false);
  });

  it('활성 행에 키워드가 없으면 비대상', () => {
    expect(isValidationTarget([{ pp: 'ABC' }, { pp: 'DEF', disabled: true }])).toBe(false);
  });

  it('빈 배열이면 비대상', () => {
    expect(isValidationTarget([])).toBe(false);
  });

  it('pp 가 없는 행도 안전하게 처리한다', () => {
    expect(isValidationTarget([{}, { pp: undefined }])).toBe(false);
  });
});

describe('computeLayerMerge', () => {
  // sp 만 다르게 주면 비교 키(process_id||sp||sd||pp)가 행마다 유일해진다.
  const row = (sp: string, over: Partial<MergeComparableRow> = {}): MergeComparableRow => ({
    id: `id_${sp}`,
    sortOrder: Number(sp),
    disabled: false,
    manuallyDisabled: false,
    process_id: 'P1',
    sp,
    sd: `SD${sp}`,
    pp: `PP${sp}`,
    st: 'O',
    new_or_copy: '신규',
    ...over,
  });

  const find = (rows: MergeComparableRow[], sp: string) => rows.find((r) => r.sp === sp);

  it('③ A·B 양쪽에 있으면 기등록(X)', () => {
    const { merged, stats } = computeLayerMerge([row('10')], [row('10')]);
    expect(find(merged, '10')).toMatchObject({ st: 'X', new_or_copy: '기등록' });
    expect(stats).toEqual({ added: 0, registered: 1, deleted: 0 });
  });

  it('① B 에만 있으면 신규(O)', () => {
    const { merged, stats } = computeLayerMerge([row('40')], [row('10')]);
    expect(find(merged, '40')).toMatchObject({ st: 'O', new_or_copy: '신규' });
    expect(stats).toMatchObject({ added: 1, registered: 0 });
  });

  it('① B 에만 있는 차용 행도 신규로 덮어쓴다', () => {
    const { merged } = computeLayerMerge([row('40', { new_or_copy: '차용' })], []);
    expect(find(merged, '40')).toMatchObject({ st: 'O', new_or_copy: '신규' });
  });

  it('② A 에만 있으면 layer삭제(X) 행을 추가하고 원본 컬럼을 잠근다', () => {
    const { merged, stats } = computeLayerMerge([], [row('20', { new_or_copy: '차용' })]);
    expect(merged).toHaveLength(1);
    // A 의 원본 st/new_or_copy('O'/'차용')를 그대로 복사하지 않는다
    expect(merged[0]).toMatchObject({ st: 'X', new_or_copy: 'layer삭제', loaded: true, disabled: false });
    expect(stats).toEqual({ added: 0, registered: 0, deleted: 1 });
  });

  it('A 의 layer삭제 행은 부재로 보므로, 같은 행이 B 에 있으면 신규가 된다', () => {
    const { merged, stats } = computeLayerMerge(
      [row('30')],
      [row('30', { st: 'X', new_or_copy: 'layer삭제' })]
    );
    expect(find(merged, '30')).toMatchObject({ st: 'O', new_or_copy: '신규' });
    // A 에서 부재이므로 layer삭제 행을 새로 추가하지도 않는다
    expect(merged).toHaveLength(1);
    expect(stats).toEqual({ added: 1, registered: 0, deleted: 0 });
  });

  it('B 의 layer삭제 행은 부재로 보고 건드리지 않으며, 중복 행도 만들지 않는다', () => {
    const { merged, stats } = computeLayerMerge(
      [row('20', { st: 'X', new_or_copy: 'layer삭제' })],
      [row('20')]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ st: 'X', new_or_copy: 'layer삭제' });
    expect(stats).toEqual({ added: 0, registered: 0, deleted: 0 });
  });

  it('비활성 행은 판정에서 제외하고 값도 유지한다', () => {
    const { merged, stats } = computeLayerMerge([row('10', { disabled: true, st: 'O', new_or_copy: '차용' })], []);
    expect(merged[0]).toMatchObject({ disabled: true, st: 'O', new_or_copy: '차용' });
    expect(stats).toEqual({ added: 0, registered: 0, deleted: 0 });
  });

  it('앞뒤 공백은 무시하고 같은 행으로 본다', () => {
    const { stats } = computeLayerMerge([row('10')], [row('10', { process_id: ' P1 ' })]);
    expect(stats).toMatchObject({ registered: 1, deleted: 0 });
  });

  it('추가되는 행마다 서로 다른 sortOrder 를 부여한다', () => {
    const { merged } = computeLayerMerge([], [row('10'), row('20'), row('30')]);
    expect(new Set(merged.map((r) => r.sortOrder)).size).toBe(3);
  });

  it('같은 A 로 다시 실행해도 결과가 같다(멱등)', () => {
    const cur = [row('10'), row('40')];
    const ref = [row('10'), row('20')];
    const once = computeLayerMerge(cur, ref);
    const twice = computeLayerMerge(once.merged, ref);
    const shape = (rows: MergeComparableRow[]) =>
      rows.map((r) => [r.sp, r.st, r.new_or_copy]).sort();
    expect(shape(twice.merged)).toEqual(shape(once.merged));
  });

  it('빈 표끼리는 아무 것도 하지 않는다', () => {
    expect(computeLayerMerge([], [])).toEqual({ merged: [], stats: { added: 0, registered: 0, deleted: 0 } });
  });

  it('시나리오: 기등록 1 / 신규 2 / layer삭제 1', () => {
    const cur = [row('10'), row('30'), row('40')];
    const ref = [row('10'), row('20'), row('30', { st: 'X', new_or_copy: 'layer삭제' })];
    const { merged, stats } = computeLayerMerge(cur, ref);
    expect(stats).toEqual({ added: 2, registered: 1, deleted: 1 });
    expect(find(merged, '10')).toMatchObject({ new_or_copy: '기등록' });
    expect(find(merged, '30')).toMatchObject({ new_or_copy: '신규' });
    expect(find(merged, '40')).toMatchObject({ new_or_copy: '신규' });
    expect(find(merged, '20')).toMatchObject({ new_or_copy: 'layer삭제' });
  });
});

describe('autoValidationSystem', () => {
  it('활성 행에 키워드가 있으면 대상', () => {
    expect(autoValidationSystem([{ pp: 'ABC' }, { pp: 'PLEL' }])).toBe(VS_TARGET);
  });

  it('키워드가 아예 없으면 해당없음 — 비대상이 아니다', () => {
    expect(autoValidationSystem([{ pp: 'ABC' }])).toBe(VS_NA);
  });

  it('비활성 행에만 키워드가 있으면 해당없음', () => {
    expect(autoValidationSystem([{ pp: 'PLEL', disabled: true }])).toBe(VS_NA);
  });

  it('빈 배열이면 해당없음', () => {
    expect(autoValidationSystem([])).toBe(VS_NA);
  });
});
