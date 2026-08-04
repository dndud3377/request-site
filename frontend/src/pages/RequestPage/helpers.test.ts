import {
  autoValidationSystem, isValidationKeywordRow, isValidationTarget, computeLayerMerge, MergeComparableRow,
  computeBeforeAfter, BaComparableRow,
  parseClipboardTable, detectAdiCdHeader, decideAdiCdPaste, buildAdiCdRows, validateAdiCdRows,
} from './helpers';
import { VS_NA, VS_TARGET } from './constants';
import { AdiCdStep } from '../../types';

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

describe('computeBeforeAfter', () => {
  // 비교 키는 process_id + layerid — 같은 layerid 를 여러 행에 주면 '모호한 그룹'이 된다.
  const r = (id: string, over: Partial<BaComparableRow> = {}): BaComparableRow => ({
    id,
    disabled: false,
    process_id: 'P1',
    sp: `SP_${id}`,
    sd: `SD_${id}`,
    pp: `PP_${id}`,
    layerid: `L_${id}`,
    ...over,
  });

  it('5개 값이 모두 같으면 어느 표에도 싣지 않는다', () => {
    const res = computeBeforeAfter([r('a')], [], [r('a')], []);
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
    expect(res.sameCount).toBe(1);
  });

  it('process_id·layerid 가 같고 sp 만 다르면 자동 1:1 (changed)', () => {
    const before = r('a');
    const after = { ...r('b'), layerid: 'L_a', sd: 'SD_a', pp: 'PP_a' };
    const res = computeBeforeAfter([before], [], [after], []);
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ table: 'J', kind: 'changed', beforeId: 'J_a', afterId: 'J_b' });
    expect(res.pairs[0].before).toMatchObject({ sp: 'SP_a', layerid: 'L_a' });
    expect(res.pairs[0].after).toMatchObject({ sp: 'SP_b', layerid: 'L_a' });
    expect(res.unmatchedAfter).toEqual([]);
  });

  it('참조에만 있으면 AFTER 미등록(deleted) 으로 자동 확정', () => {
    const res = computeBeforeAfter([r('a')], [], [], []);
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ kind: 'deleted', after: null, afterId: null });
    expect(res.pairs[0].before).toMatchObject({ layerid: 'L_a' });
  });

  it('현재 요청서에만 있으면 BEFORE 미등록(added) 으로 자동 확정', () => {
    const res = computeBeforeAfter([], [], [r('b')], []);
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ kind: 'added', before: null, beforeId: null });
    expect(res.pairs[0].after).toMatchObject({ layerid: 'L_b' });
  });

  it('같은 그룹에 A 2행·B 2행이면 자동 매칭하지 않고 미매칭으로 분류한다', () => {
    const refs = [r('a1', { layerid: 'L1' }), r('a2', { layerid: 'L1' })];
    const curs = [r('b1', { layerid: 'L1' }), r('b2', { layerid: 'L1' })];
    const res = computeBeforeAfter(refs, [], curs, []);
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore.map((x) => x.id)).toEqual(['J_a1', 'J_a2']);
    expect(res.unmatchedAfter.map((x) => x.id)).toEqual(['J_b1', 'J_b2']);
  });

  it('A 3행·B 0행이면 모호성이 없으므로 3건 모두 자동 deleted', () => {
    const refs = [r('a1', { layerid: 'L1' }), r('a2', { layerid: 'L1' }), r('a3', { layerid: 'L1' })];
    const res = computeBeforeAfter(refs, [], [], []);
    expect(res.pairs).toHaveLength(3);
    expect(res.pairs.every((p) => p.kind === 'deleted')).toBe(true);
    expect(res.unmatchedBefore).toEqual([]);
  });

  it('layerid 가 빈 행은 비교에서 제외한다', () => {
    const res = computeBeforeAfter([r('a', { layerid: '' })], [], [r('b', { layerid: '  ' })], []);
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
  });

  it('비활성 행은 비교에서 제외한다', () => {
    const res = computeBeforeAfter([r('a', { disabled: true })], [], [r('b', { disabled: true })], []);
    expect(res.pairs).toEqual([]);
  });

  it('J-ayer 와 O-ayer 는 독립 비교한다 (같은 키여도 섞이지 않는다)', () => {
    const jRef = [r('j1', { layerid: 'L1' })];
    const oCur = [r('o1', { layerid: 'L1' })];
    const res = computeBeforeAfter(jRef, [], [], oCur);
    expect(res.pairs).toHaveLength(2);
    expect(res.pairs.find((p) => p.table === 'J')).toMatchObject({ kind: 'deleted' });
    expect(res.pairs.find((p) => p.table === 'O')).toMatchObject({ kind: 'added' });
  });

  it('앞뒤 공백은 정규화해 비교한다', () => {
    const res = computeBeforeAfter(
      [r('a', { process_id: ' P1 ', layerid: ' L1 ', sp: ' S1 ', sd: 'D', pp: 'P' })],
      [],
      [r('b', { process_id: 'P1', layerid: 'L1', sp: 'S1', sd: 'D', pp: 'P' })],
      []
    );
    expect(res.pairs).toEqual([]);
    expect(res.sameCount).toBe(1);
  });

  it('같은 입력이면 항상 같은 결과를 낸다 (멱등)', () => {
    const refs = [r('a1', { layerid: 'L1' }), r('a2', { layerid: 'L2' })];
    const curs = [r('b1', { layerid: 'L2' }), r('b2', { layerid: 'L3' })];
    expect(computeBeforeAfter(refs, [], curs, [])).toEqual(computeBeforeAfter(refs, [], curs, []));
  });

  it('빈 표끼리는 아무 것도 만들지 않는다', () => {
    expect(computeBeforeAfter([], [], [], [])).toEqual({
      pairs: [], unmatchedBefore: [], unmatchedAfter: [], sameCount: 0,
    });
  });
});

describe('parseClipboardTable', () => {
  it('탭으로 셀을 나눈다', () => {
    expect(parseClipboardTable('a\tb\tc')).toEqual([['a', 'b', 'c']]);
  });

  it('\\r\\n, \\r 을 \\n 으로 정규화한다', () => {
    expect(parseClipboardTable('a\tb\r\nc\td\re\tf')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
  });

  it('인용된 셀 안의 탭·이스케이프된 큰따옴표를 보존한다', () => {
    expect(parseClipboardTable('"a\tb"\t"say ""hi"""')).toEqual([['a\tb', 'say "hi"']]);
  });

  it('가장자리 완전 빈 행만 제거하고 중간 빈 행은 남긴다', () => {
    expect(parseClipboardTable('\n\na\tb\n\nc\td\n\n')).toEqual([['a', 'b'], [''], ['c', 'd']]);
  });
});

describe('detectAdiCdHeader', () => {
  it('첫 행에서 헤더를 찾는다', () => {
    expect(detectAdiCdHeader([['STEP_ID', 'STEP_DESC'], ['S1', 'D1']]))
      .toEqual({ headerRow: 0, stepIdCol: 0, stepDescCol: 1 });
  });

  it('공백·언더스코어·대소문자를 정규화해 매칭한다', () => {
    expect(detectAdiCdHeader([['step id', 'Step-Desc']]))
      .toEqual({ headerRow: 0, stepIdCol: 0, stepDescCol: 1 });
  });

  it('열 순서가 뒤바뀌어도 인덱스로 정확히 잡는다', () => {
    expect(detectAdiCdHeader([['STEP_DESC', 'STEP_ID']]))
      .toEqual({ headerRow: 0, stepIdCol: 1, stepDescCol: 0 });
  });

  it('제목 행·빈 행이 섞여 있어도 최대 5행 안에서 찾는다', () => {
    expect(detectAdiCdHeader([['제목'], [''], ['번호', 'STEP_ID', 'STEP_DESC', '비고'], ['1', 'S1', 'D1', '']]))
      .toEqual({ headerRow: 2, stepIdCol: 1, stepDescCol: 2 });
  });

  it('5행을 넘어가면 찾지 못한다', () => {
    const grid = [['1'], ['2'], ['3'], ['4'], ['5'], ['STEP_ID', 'STEP_DESC']];
    expect(detectAdiCdHeader(grid)).toBeNull();
  });

  it('헤더가 없으면 null', () => {
    expect(detectAdiCdHeader([['S1', 'D1']])).toBeNull();
  });
});

describe('decideAdiCdPaste', () => {
  it('2열 + 헤더 인식 성공 → 모달 불필요', () => {
    const d = decideAdiCdPaste([['STEP_ID', 'STEP_DESC'], ['S1', 'D1']]);
    expect(d.needsModal).toBe(false);
    expect(d.columnCount).toBe(2);
  });

  it('2열 + 헤더 없음 → 모달 필요', () => {
    expect(decideAdiCdPaste([['S1', 'D1']]).needsModal).toBe(true);
  });

  it('3열 이상 + 헤더 인식 성공 → 모달 필요(단, 인식된 열 정보는 함께 돌려준다)', () => {
    const d = decideAdiCdPaste([['번호', 'STEP_ID', 'STEP_DESC'], ['1', 'S1', 'D1']]);
    expect(d.needsModal).toBe(true);
    expect(d.header).toEqual({ headerRow: 0, stepIdCol: 1, stepDescCol: 2 });
  });

  it('3열 이상 + 헤더 없음 → 모달 필요, header 는 null', () => {
    const d = decideAdiCdPaste([['1', 'S1', 'D1']]);
    expect(d.needsModal).toBe(true);
    expect(d.header).toBeNull();
  });
});

describe('buildAdiCdRows', () => {
  it('지정한 시작 행부터 두 열만 취해 trim 한다', () => {
    const rows = buildAdiCdRows(
      [['STEP_ID', 'STEP_DESC'], [' S1 ', ' D1 '], ['S2', 'D2']],
      { stepIdCol: 0, stepDescCol: 1 },
      1
    );
    expect(rows.map((r) => ({ step_id: r.step_id, step_desc: r.step_desc }))).toEqual([
      { step_id: 'S1', step_desc: 'D1' },
      { step_id: 'S2', step_desc: 'D2' },
    ]);
  });

  it('두 값이 모두 빈 행은 드롭한다', () => {
    const rows = buildAdiCdRows([['', ''], ['S1', 'D1'], [' ', ' ']], { stepIdCol: 0, stepDescCol: 1 }, 0);
    expect(rows).toHaveLength(1);
  });

  it('매핑된 두 열 외 나머지 열은 버린다', () => {
    const rows = buildAdiCdRows([['1', 'S1', 'D1', '비고']], { stepIdCol: 1, stepDescCol: 2 }, 0);
    expect(rows[0].step_id).toBe('S1');
    expect(rows[0].step_desc).toBe('D1');
  });

  it('각 행에 고유 id 를 부여한다', () => {
    const rows = buildAdiCdRows([['S1', 'D1'], ['S2', 'D2']], { stepIdCol: 0, stepDescCol: 1 }, 0);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});

describe('validateAdiCdRows', () => {
  const step = (over: Partial<AdiCdStep>): AdiCdStep => ({ id: `id_${Math.random()}`, step_id: '', step_desc: '', ...over });

  it('완전히 빈 행은 세지 않는다', () => {
    expect(validateAdiCdRows([step({}), step({ step_id: 'S1', step_desc: 'D1' })])).toEqual({
      incompleteIds: [], duplicateIds: [], validCount: 1,
    });
  });

  it('한쪽만 채워진 행은 불완전으로 잡는다', () => {
    const r = step({ id: 'r1', step_id: 'S1', step_desc: '' });
    expect(validateAdiCdRows([r])).toEqual({ incompleteIds: ['r1'], duplicateIds: [], validCount: 0 });
  });

  it('STEP_ID 가 중복되면 두 행 모두 잡는다', () => {
    const a = step({ id: 'a', step_id: 'DUP', step_desc: 'D1' });
    const b = step({ id: 'b', step_id: 'DUP', step_desc: 'D2' });
    const result = validateAdiCdRows([a, b]);
    expect(result.duplicateIds.sort()).toEqual(['a', 'b']);
    expect(result.validCount).toBe(2);
  });

  it('정상 표는 전부 0개, validCount 는 행 수만큼', () => {
    const rows = [step({ step_id: 'S1', step_desc: 'D1' }), step({ step_id: 'S2', step_desc: 'D2' })];
    expect(validateAdiCdRows(rows)).toEqual({ incompleteIds: [], duplicateIds: [], validCount: 2 });
  });

  it('빈 배열이면 전부 0', () => {
    expect(validateAdiCdRows([])).toEqual({ incompleteIds: [], duplicateIds: [], validCount: 0 });
  });
});
