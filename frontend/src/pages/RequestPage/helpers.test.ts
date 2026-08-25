import {
  autoValidationSystem, isValidationKeywordRow, isValidationTarget, computeLayerMerge, MergeComparableRow,
  computeBeforeAfter, BaComparableRow,
  parseClipboardTable, detectAdiCdHeader, decideAdiCdPaste, buildAdiCdRows, validateAdiCdRows, balanceAdiCdRows,
  validateAdiCdTargets,
  requiresBbEntries, findBbEntryViolations, findEmptyStNocViolations, findNocBorrowItemIdViolations,
  isMergeSideEmpty, normalizeMergeSide, deriveMergeKind, emptyMergeRowInfo, emptyMergePair,
  parseMergePasteRows, validateMergePairs, applyMergePaste, computeExpectedRequestPurpose,
  isPairAfterInactive,
} from './helpers';
import { VS_NA, VS_TARGET, NOC_LAYER_DELETE, NOC_NEW, NOC_REGISTERED, ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL } from './constants';
import { AdiCdStep, AdiCdTarget, MergePair, MergeRowInfo } from '../../types';

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

describe('requiresBbEntries', () => {
  it("활성 행에 st='O' 가 있으면 필수", () => {
    expect(requiresBbEntries([{ disabled: false, st: 'X' }, { disabled: false, st: 'O' }])).toBe(true);
  });

  it("'O (D)' 도 O 계열로 본다", () => {
    expect(requiresBbEntries([{ disabled: false, st: 'O (D)' }])).toBe(true);
  });

  it('비활성 행은 판정에서 제외한다', () => {
    expect(requiresBbEntries([{ disabled: true, st: 'O' }])).toBe(false);
  });

  it('O 계열 행이 없거나 표가 비면 필수가 아니다', () => {
    expect(requiresBbEntries([{ disabled: false, st: 'X' }])).toBe(false);
    expect(requiresBbEntries([])).toBe(false);
  });
});

describe('findBbEntryViolations', () => {
  const full = { id: 'a', location: 'L', product: 'P', process_id: 'C' };
  const partial = { id: 'b', location: 'L', product: '', process_id: '' };
  const empty = { id: 'c', location: '', product: '', process_id: '' };

  it('필수일 때는 빈 항목·부분 항목 모두 위반', () => {
    expect(findBbEntryViolations([full, partial, empty], true)).toEqual(['b', 'c']);
  });

  it('필수가 아니면 부분 입력 항목만 위반', () => {
    expect(findBbEntryViolations([full, partial, empty], false)).toEqual(['b']);
  });

  it('공백만 있는 값은 빈 값으로 본다', () => {
    expect(findBbEntryViolations([{ id: 'd', location: '  ', product: '', process_id: '' }], false)).toEqual([]);
  });

  it('모두 완전하면 위반 없음', () => {
    expect(findBbEntryViolations([full], true)).toEqual([]);
  });
});

describe('findEmptyStNocViolations', () => {
  it('활성 행의 st 또는 new_or_copy 가 비면 위반', () => {
    expect(findEmptyStNocViolations([
      { id: 'a', disabled: false, st: 'O', new_or_copy: '신규' },
      { id: 'b', disabled: false, st: '', new_or_copy: '신규' },
      { id: 'c', disabled: false, st: 'X', new_or_copy: '' },
    ])).toEqual(['b', 'c']);
  });

  it('비활성 행은 제외한다', () => {
    expect(findEmptyStNocViolations([{ id: 'a', disabled: true, st: '', new_or_copy: '' }])).toEqual([]);
  });
});

describe('findNocBorrowItemIdViolations', () => {
  it("new_or_copy='차용' 활성 행 중 item_id 가 비면 위반", () => {
    expect(findNocBorrowItemIdViolations([
      { id: 'a', disabled: false, new_or_copy: '차용', item_id: 'IT-1' },
      { id: 'b', disabled: false, new_or_copy: '차용', item_id: '' },
      { id: 'c', disabled: false, new_or_copy: '신규', item_id: '' },
    ])).toEqual(['b']);
  });

  it('비활성 행은 제외한다', () => {
    expect(findNocBorrowItemIdViolations([
      { id: 'a', disabled: true, new_or_copy: '차용', item_id: '' },
    ])).toEqual([]);
  });
});

describe('computeExpectedRequestPurpose', () => {
  const row = (new_or_copy: string, disabled = false) => ({ disabled, new_or_copy });

  it('신규만 있으면 신규', () => {
    expect(computeExpectedRequestPurpose([row('신규')], [])).toBe('신규');
  });

  it('차용만 있으면 차용', () => {
    expect(computeExpectedRequestPurpose([], [row('차용')])).toBe('차용');
  });

  it('신규와 차용이 jayer/oayer 에 나뉘어 있어도 신규+차용', () => {
    expect(computeExpectedRequestPurpose([row('신규')], [row('차용')])).toBe('신규+차용');
  });

  it('기등록·layer삭제만 있으면 기타', () => {
    expect(computeExpectedRequestPurpose([row('기등록')], [row('layer삭제')])).toBe('기타');
  });

  it('신규 + 기등록이면 기등록은 무시하고 신규', () => {
    expect(computeExpectedRequestPurpose([row('신규'), row('기등록')], [])).toBe('신규');
  });

  it('비활성 행은 판정에서 제외한다', () => {
    expect(computeExpectedRequestPurpose([row('신규', true)], [])).toBeNull();
  });

  it('활성 행이 없으면 null(판정 불가)', () => {
    expect(computeExpectedRequestPurpose([], [])).toBeNull();
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

  it('③\' 참조(A)의 st 가 이미 X(이미 확정된 기등록)이면 cur 행을 건드리지 않는다', () => {
    const cur = [row('10', { st: 'O', new_or_copy: '차용' })]; // JOB FILE 자동채움 등으로 아직 미확정 상태
    const ref = [row('10', { st: 'X', new_or_copy: '기등록' })]; // 이전 세대에서 이미 확정됨
    const { merged, stats } = computeLayerMerge(cur, ref);
    // 강제로 X/기등록 으로 재도장하지 않고 cur 의 현재 값을 그대로 둔다.
    expect(find(merged, '10')).toMatchObject({ st: 'O', new_or_copy: '차용' });
    expect(stats).toEqual({ added: 0, registered: 1, deleted: 0 });
  });

  it('③ 참조(A)의 st 가 아직 X 가 아니면(처음 확정되는 시점) 기존대로 X/기등록 으로 재도장한다', () => {
    const cur = [row('10', { st: 'O', new_or_copy: '신규' })];
    const ref = [row('10', { st: 'O', new_or_copy: '신규' })]; // 아직 확정 전
    const { merged, stats } = computeLayerMerge(cur, ref);
    expect(find(merged, '10')).toMatchObject({ st: 'X', new_or_copy: '기등록' });
    expect(stats).toEqual({ added: 0, registered: 1, deleted: 0 });
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

  it('완전 일치 짝이 있으면 같은 그룹에 다른 행이 있어도 BEFORE/AFTER 에 싣지 않는다', () => {
    // A=[X], B=[Y(X와 5개 값 동일), Z(process_id·layerid 만 같고 sp 다름)]
    const x = r('x', { layerid: 'L1' });
    const y = { ...r('y', { layerid: 'L1' }), sp: x.sp, sd: x.sd, pp: x.pp };
    const z = { ...r('z', { layerid: 'L1' }), sd: x.sd, pp: x.pp };
    const res = computeBeforeAfter([x], [], [y, z], []);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
    expect(res.sameCount).toBe(1);
    // X 는 Y 에 소진됐으므로 Z 는 BEFORE 미등록(added) 으로 자동 확정된다.
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ kind: 'added', beforeId: null, afterId: 'J_z' });
  });

  it('완전 일치 짝을 뺀 나머지가 1:1 이면 자동 changed 로 확정한다', () => {
    const a1 = r('a1', { layerid: 'L1' });
    const b1 = { ...r('b1', { layerid: 'L1' }), sp: a1.sp, sd: a1.sd, pp: a1.pp };  // a1 과 완전 일치
    const a2 = r('a2', { layerid: 'L1' });
    const b2 = { ...r('b2', { layerid: 'L1' }), sd: a2.sd, pp: a2.pp };             // a2 와 sp 만 다름
    const res = computeBeforeAfter([a1, a2], [], [b1, b2], []);
    expect(res.sameCount).toBe(1);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ kind: 'changed', beforeId: 'J_a2', afterId: 'J_b2' });
  });

  it('완전 일치를 뺀 나머지가 여전히 모호하면 그 잔여만 미매칭으로 남는다', () => {
    const a1 = r('a1', { layerid: 'L1' });
    const b1 = { ...r('b1', { layerid: 'L1' }), sp: a1.sp, sd: a1.sd, pp: a1.pp };  // a1 과 완전 일치
    const refs = [a1, r('a2', { layerid: 'L1' })];
    const curs = [b1, r('b2', { layerid: 'L1' }), r('b3', { layerid: 'L1' })];
    const res = computeBeforeAfter(refs, [], curs, []);
    expect(res.sameCount).toBe(1);
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore.map((x) => x.id)).toEqual(['J_a2']);
    expect(res.unmatchedAfter.map((x) => x.id)).toEqual(['J_b2', 'J_b3']);
  });

  it('완전 일치 A 행 1개가 동일한 B 행 2개를 모두 소진하지는 않는다', () => {
    const a1 = r('a1', { layerid: 'L1' });
    const same = { sp: a1.sp, sd: a1.sd, pp: a1.pp, layerid: 'L1' };
    const res = computeBeforeAfter([a1], [], [{ ...r('b1'), ...same }, { ...r('b2'), ...same }], []);
    expect(res.sameCount).toBe(1);
    // 남은 B 1행은 짝지을 A 가 없으므로 BEFORE 미등록(added) 으로 자동 확정된다.
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ kind: 'added', afterId: 'J_b2' });
    expect(res.unmatchedAfter).toEqual([]);
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

  // 참조 요청서 체인(A→B→C...) — B가 A를 참조해 3-way 병합된 결과를 C가 다시 참조할 때,
  // B 안의 'layer삭제' 행(A→B 때 이미 확정된 삭제)이 C 비교에서 재등장하면 안 된다.
  it('참조(ref)의 layer삭제 행은 비교 대상에서 제외한다 — 없던 것으로 취급', () => {
    const res = computeBeforeAfter(
      [r('a', { new_or_copy: NOC_LAYER_DELETE })],
      [],
      [],
      []
    );
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
  });

  it('참조의 layer삭제 행과 같은 그룹에 있어도, cur 쪽 다른 행은 정상 비교된다', () => {
    // ref = [기등록 L1, layer삭제 L1]  (같은 layerid 그룹에 라벨만 다른 두 행)
    // cur = [L1 신규] → layer삭제 행은 제외되므로, 남은 기등록 L1과만 비교된다.
    const registered = r('a1', { layerid: 'L1', new_or_copy: NOC_NEW });
    const deleted = r('a2', { layerid: 'L1', new_or_copy: NOC_LAYER_DELETE });
    const cur = { ...r('b1', { layerid: 'L1' }), sp: registered.sp, sd: registered.sd, pp: registered.pp };
    const res = computeBeforeAfter([registered, deleted], [], [cur], []);
    expect(res.sameCount).toBe(1);
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
  });

  it('참조 시점에 layer삭제였던 layer가 cur 에 다시 나타나면 added(신규) 로 뜬다', () => {
    const res = computeBeforeAfter(
      [r('a', { layerid: 'L3', new_or_copy: NOC_LAYER_DELETE })],
      [],
      [r('b', { layerid: 'L3' })],
      []
    );
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toMatchObject({ kind: 'added', beforeId: null, afterId: 'J_b' });
    expect(res.pairs[0].after).toMatchObject({ layerid: 'L3' });
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
  });

  it('cur 쪽 layer삭제 라벨은 영향 없다 (ref 쪽만 제외 대상)', () => {
    // r() 기본값은 new_or_copy 가 없으므로(undefined), cur 에 명시적으로 layer삭제를 줘도
    // 필터 조건(!disabled && layerid!=='' && new_or_copy!=='layer삭제')에 의해 제외된다 —
    // 실제 앱에서 cur 쪽에 layer삭제 라벨이 남아있을 일은 없지만(계속 작성 중인 표), 방어적으로 확인.
    const res = computeBeforeAfter([], [], [r('b', { new_or_copy: NOC_LAYER_DELETE })], []);
    expect(res.pairs).toEqual([]);
    expect(res.unmatchedBefore).toEqual([]);
    expect(res.unmatchedAfter).toEqual([]);
  });
});

describe('isPairAfterInactive', () => {
  const jayer = [{ id: 'j1', disabled: false, new_or_copy: '신규' }];
  const oayer = [{ id: 'o1', disabled: false, new_or_copy: '신규' }];

  it('afterId 가 null 이면 false (수기로 추가한 행)', () => {
    expect(isPairAfterInactive(null, jayer, oayer)).toBe(false);
  });

  it('연결된 행이 활성 + 기등록이 아니면 false', () => {
    expect(isPairAfterInactive('J_j1', jayer, oayer)).toBe(false);
  });

  it('연결된 행이 비활성이면 true', () => {
    const rows = [{ id: 'j1', disabled: true, new_or_copy: '신규' }];
    expect(isPairAfterInactive('J_j1', rows, oayer)).toBe(true);
  });

  it('연결된 행이 기등록으로 바뀌면 true', () => {
    const rows = [{ id: 'j1', disabled: false, new_or_copy: NOC_REGISTERED }];
    expect(isPairAfterInactive('J_j1', rows, oayer)).toBe(true);
  });

  it('비활성을 해제하고 신규로 되돌리면 다시 false', () => {
    const inactive = [{ id: 'j1', disabled: true, new_or_copy: NOC_REGISTERED }];
    expect(isPairAfterInactive('J_j1', inactive, oayer)).toBe(true);
    const restored = [{ id: 'j1', disabled: false, new_or_copy: '신규' }];
    expect(isPairAfterInactive('J_j1', restored, oayer)).toBe(false);
  });

  it('O-layer 행도 동일하게 판정한다', () => {
    const rows = [{ id: 'o1', disabled: true, new_or_copy: '신규' }];
    expect(isPairAfterInactive('O_o1', jayer, rows)).toBe(true);
  });

  it('id 에 밑줄이 포함돼도(genId 형식) 올바르게 찾는다', () => {
    const rows = [{ id: '1699999999999_ab12cd', disabled: true, new_or_copy: '신규' }];
    expect(isPairAfterInactive('J_1699999999999_ab12cd', rows, oayer)).toBe(true);
  });

  it('연결된 행이 표에서 아예 지워졌으면 false', () => {
    expect(isPairAfterInactive('J_gone', jayer, oayer)).toBe(false);
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
    expect(detectAdiCdHeader([[ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL], ['S1', 'D1']]))
      .toEqual({ headerRow: 0, stepIdCol: 0, stepDescCol: 1 });
  });

  it('공백·언더스코어·대소문자를 정규화해 매칭한다', () => {
    expect(detectAdiCdHeader([['stepseq', 'step 설명']]))
      .toEqual({ headerRow: 0, stepIdCol: 0, stepDescCol: 1 });
  });

  it('열 순서가 뒤바뀌어도 인덱스로 정확히 잡는다', () => {
    expect(detectAdiCdHeader([[ADI_CD_STEP_DESC_LABEL, ADI_CD_STEP_ID_LABEL]]))
      .toEqual({ headerRow: 0, stepIdCol: 1, stepDescCol: 0 });
  });

  it('제목 행·빈 행이 섞여 있어도 최대 5행 안에서 찾는다', () => {
    expect(detectAdiCdHeader([['제목'], [''], ['번호', ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL, '비고'], ['1', 'S1', 'D1', '']]))
      .toEqual({ headerRow: 2, stepIdCol: 1, stepDescCol: 2 });
  });

  it('5행을 넘어가면 찾지 못한다', () => {
    const grid = [['1'], ['2'], ['3'], ['4'], ['5'], [ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL]];
    expect(detectAdiCdHeader(grid)).toBeNull();
  });

  it('헤더가 없으면 null', () => {
    expect(detectAdiCdHeader([['S1', 'D1']])).toBeNull();
  });
});

describe('decideAdiCdPaste', () => {
  it('2열 + 헤더 인식 성공 → 모달 불필요', () => {
    const d = decideAdiCdPaste([[ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL], ['S1', 'D1']]);
    expect(d.needsModal).toBe(false);
    expect(d.columnCount).toBe(2);
  });

  it('2열 + 헤더 없음 → 모달 불필요(2열이면 헤더 유무와 무관하게 즉시 적용)', () => {
    const d = decideAdiCdPaste([['S1', 'D1']]);
    expect(d.needsModal).toBe(false);
    expect(d.header).toBeNull();
  });

  it('3열 이상 + 헤더 인식 성공 → 모달 필요(단, 인식된 열 정보는 함께 돌려준다)', () => {
    const d = decideAdiCdPaste([['번호', ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL], ['1', 'S1', 'D1']]);
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
      [[ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL], [' S1 ', ' D1 '], ['S2', 'D2']],
      { stepIdCol: 0, stepDescCol: 1 },
      1
    );
    expect(rows.map((r) => ({ step_id: r.step_id, step_desc: r.step_desc }))).toEqual([
      { step_id: 'S1', step_desc: 'D1' },
      { step_id: 'S2', step_desc: 'D2' },
    ]);
  });

  it('두 값이 모두 빈 행은 미등록 행으로 만든다(드롭하지 않는다)', () => {
    const rows = buildAdiCdRows([['', ''], ['S1', 'D1'], [' ', ' ']], { stepIdCol: 0, stepDescCol: 1 }, 0);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ step_id: '', step_desc: '', unregistered: true });
    expect(rows[1]).toMatchObject({ step_id: 'S1', step_desc: 'D1', unregistered: false });
    expect(rows[2]).toMatchObject({ step_id: '', step_desc: '', unregistered: true });
  });

  it('한쪽만 빈 행은 미등록으로 만들지 않고 값 그대로 채운다', () => {
    const rows = buildAdiCdRows([['', 'B'], ['A', '']], { stepIdCol: 0, stepDescCol: 1 }, 0);
    expect(rows[0]).toMatchObject({ step_id: '', step_desc: 'B', unregistered: false });
    expect(rows[1]).toMatchObject({ step_id: 'A', step_desc: '', unregistered: false });
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

  it('완전히 빈 행(미등록 아님)은 불완전으로 잡는다', () => {
    const blank = step({ id: 'r0' });
    const result = validateAdiCdRows([blank, step({ step_id: 'S1', step_desc: 'D1' })]);
    expect(result.incompleteIds).toEqual(['r0']);
    expect(result.duplicateIds).toEqual([]);
    expect(result.validCount).toBe(1);
  });

  it('완전히 빈 행이라도 미등록이면 유효로 잡는다', () => {
    expect(validateAdiCdRows([step({ unregistered: true }), step({ step_id: 'S1', step_desc: 'D1' })])).toEqual({
      incompleteIds: [], duplicateIds: [], validCount: 2,
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

describe('balanceAdiCdRows', () => {
  const step = (over: Partial<AdiCdStep> = {}): AdiCdStep => ({ id: `id_${Math.random()}`, step_id: '', step_desc: '', ...over });

  it('길이가 같으면 원본을 그대로(참조 동일) 돌려준다', () => {
    const before = [step(), step()];
    const after = [step(), step()];
    const result = balanceAdiCdRows(before, after);
    expect(result.before).toBe(before);
    expect(result.after).toBe(after);
  });

  it('변경전이 더 길면 변경후 끝에 빈 행을 채운다', () => {
    const before = [step({ step_id: 'A' }), step({ step_id: 'B' }), step({ step_id: 'C' })];
    const after = [step({ step_id: 'X' })];
    const result = balanceAdiCdRows(before, after);
    expect(result.before).toBe(before); // 짧은 쪽만 조정, 긴 쪽은 원본 그대로
    expect(result.after).toHaveLength(3);
    expect(result.after[0].step_id).toBe('X');
    expect(result.after[1]).toMatchObject({ step_id: '', step_desc: '', unregistered: false });
    expect(result.after[2]).toMatchObject({ step_id: '', step_desc: '', unregistered: false });
  });

  it('변경후가 더 길면 변경전 끝에 빈 행을 채운다', () => {
    const before = [step({ step_id: 'A' })];
    const after = [step({ step_id: 'X' }), step({ step_id: 'Y' })];
    const result = balanceAdiCdRows(before, after);
    expect(result.after).toBe(after);
    expect(result.before).toHaveLength(2);
    expect(result.before[1]).toMatchObject({ step_id: '', step_desc: '' });
  });

  it('채워 넣은 빈 행마다 서로 다른 id 를 부여한다', () => {
    const result = balanceAdiCdRows([], [step(), step(), step()]);
    const ids = new Set(result.before.map((r) => r.id));
    expect(ids.size).toBe(3);
  });
});

describe('validateAdiCdTargets', () => {
  const target = (over: Partial<AdiCdTarget> = {}): AdiCdTarget => ({ id: `id_${Math.random()}`, partid_selection: '', process_id: '', ...over });
  const first = { partid_selection: 'PART_1', process_id: 'PROC_1' };

  it('추가 행이 없으면 둘 다 false', () => {
    expect(validateAdiCdTargets(first, [])).toEqual({ hasIncomplete: false, hasDuplicate: false });
  });

  it('추가 행이 모두 완전하고 중복 없으면 둘 다 false', () => {
    const extras = [target({ partid_selection: 'PART_2', process_id: 'PROC_2' })];
    expect(validateAdiCdTargets(first, extras)).toEqual({ hasIncomplete: false, hasDuplicate: false });
  });

  it('제품 이름·조리법 중 하나만 채운 행이 있으면 hasIncomplete', () => {
    const extras = [target({ partid_selection: 'PART_2', process_id: '' })];
    expect(validateAdiCdTargets(first, extras).hasIncomplete).toBe(true);
  });

  it('완전히 빈 행은 미완성으로 치지 않는다', () => {
    const extras = [target()];
    expect(validateAdiCdTargets(first, extras).hasIncomplete).toBe(false);
  });

  it('추가 행이 1행(first)과 같은 조합이면 hasDuplicate', () => {
    const extras = [target({ partid_selection: first.partid_selection, process_id: first.process_id })];
    expect(validateAdiCdTargets(first, extras).hasDuplicate).toBe(true);
  });

  it('추가 행끼리 같은 조합이면 hasDuplicate', () => {
    const extras = [
      target({ partid_selection: 'PART_2', process_id: 'PROC_2' }),
      target({ partid_selection: 'PART_2', process_id: 'PROC_2' }),
    ];
    expect(validateAdiCdTargets(first, extras).hasDuplicate).toBe(true);
  });

  it('미완성 행은 중복 판정에서 제외된다', () => {
    const extras = [
      target({ partid_selection: 'PART_2', process_id: '' }),
      target({ partid_selection: 'PART_2', process_id: '' }),
    ];
    expect(validateAdiCdTargets(first, extras).hasDuplicate).toBe(false);
  });
});

// ===== 변경전/변경후 표 직접 입력 =====

const info = (over: Partial<MergeRowInfo> = {}): MergeRowInfo => ({ ...emptyMergeRowInfo(), ...over });

const pair = (over: Partial<MergePair> = {}): MergePair => ({ ...emptyMergePair(), ...over });

describe('isMergeSideEmpty / normalizeMergeSide', () => {
  it('null 과 4칸이 모두 빈 값은 미등록', () => {
    expect(isMergeSideEmpty(null)).toBe(true);
    expect(isMergeSideEmpty(info())).toBe(true);
    expect(isMergeSideEmpty(info({ process_id: '  ' }))).toBe(true);
  });

  it('layerid 만 있는 쪽도 미등록 — layerid 는 수기 입력 대상이 아니다', () => {
    expect(isMergeSideEmpty(info({ layerid: 'L1' }))).toBe(true);
  });

  it('4칸 중 하나라도 값이 있으면 미등록이 아니다', () => {
    expect(isMergeSideEmpty(info({ sd: 'SD1' }))).toBe(false);
  });

  it('normalizeMergeSide 는 빈 쪽을 null 로 접고 값이 있으면 그대로 둔다', () => {
    expect(normalizeMergeSide(info())).toBeNull();
    const filled = info({ pp: 'PP1' });
    expect(normalizeMergeSide(filled)).toBe(filled);
  });
});

describe('deriveMergeKind', () => {
  it('양쪽 미등록 → empty', () => {
    expect(deriveMergeKind(null, null)).toBe('empty');
    expect(deriveMergeKind(info(), info())).toBe('empty');
  });

  it('변경전만 미등록 → added', () => {
    expect(deriveMergeKind(null, info({ process_id: 'A' }))).toBe('added');
  });

  it('변경후만 미등록 → deleted', () => {
    expect(deriveMergeKind(info({ process_id: 'A' }), null)).toBe('deleted');
  });

  it('양쪽 값 있음 → changed', () => {
    expect(deriveMergeKind(info({ process_id: 'A' }), info({ process_id: 'B' }))).toBe('changed');
  });
});

describe('parseMergePasteRows', () => {
  it('4열 × 3행을 그대로 파싱한다', () => {
    const raw = 'A1\tSP1\tSD1\tPP1\nA2\tSP2\tSD2\tPP2\nA3\tSP3\tSD3\tPP3';
    expect(parseMergePasteRows(raw)).toEqual([
      ['A1', 'SP1', 'SD1', 'PP1'],
      ['A2', 'SP2', 'SD2', 'PP2'],
      ['A3', 'SP3', 'SD3', 'PP3'],
    ]);
  });

  it('5열 이상은 앞 4열만 쓴다', () => {
    expect(parseMergePasteRows('A1\tSP1\tSD1\tPP1\tL1\tX')).toEqual([['A1', 'SP1', 'SD1', 'PP1']]);
  });

  it('4열보다 적으면 없는 칸은 undefined 로 남긴다', () => {
    expect(parseMergePasteRows('A1\tSP1')).toEqual([['A1', 'SP1', undefined, undefined]]);
  });

  it('빈 줄은 버리고 각 칸의 공백은 정리한다', () => {
    expect(parseMergePasteRows('  A1 \t SP1\t\t\n\nA2\tSP2\tSD2\tPP2\n')).toEqual([
      ['A1', 'SP1', '', ''],
      ['A2', 'SP2', 'SD2', 'PP2'],
    ]);
  });

  it('빈 문자열이면 빈 배열', () => {
    expect(parseMergePasteRows('')).toEqual([]);
  });
});

describe('emptyMergePair', () => {
  it('양쪽 미등록·판정 empty·기본 구분 J 로 시작한다', () => {
    const p = emptyMergePair();
    expect(p.before).toBeNull();
    expect(p.after).toBeNull();
    expect(p.kind).toBe('empty');
    expect(p.table).toBe('J');
    expect(p.beforeId).toBeNull();
    expect(p.afterId).toBeNull();
    expect(p.id).toBeTruthy();
  });

  it('구분을 지정하면 그대로 쓴다', () => {
    expect(emptyMergePair('O').table).toBe('O');
  });
});

describe('validateMergePairs', () => {
  it('양쪽 미등록 행은 blankRows 로만 세고 4칸 검사는 하지 않는다', () => {
    expect(validateMergePairs([pair()])).toEqual({ incompleteCells: 0, blankRows: 1, validCount: 0 });
  });

  it('미등록이 아닌 쪽의 빈 칸을 센다 (4칸 필수)', () => {
    const p = pair({ before: info({ process_id: 'A', sp: 'SP1' }) });
    expect(validateMergePairs([p])).toEqual({ incompleteCells: 2, blankRows: 0, validCount: 1 });
  });

  it('미등록 쪽은 검사에서 제외한다', () => {
    const p = pair({ before: null, after: info({ process_id: 'A', sp: 'SP1', sd: 'SD1', pp: 'PP1' }) });
    expect(validateMergePairs([p])).toEqual({ incompleteCells: 0, blankRows: 0, validCount: 1 });
  });

  it('layerid 가 비어 있어도 오류가 아니다 — 수기 입력 대상이 아니다', () => {
    const full = info({ process_id: 'A', sp: 'SP1', sd: 'SD1', pp: 'PP1' });
    const p = pair({ before: full, after: full });
    expect(validateMergePairs([p]).incompleteCells).toBe(0);
  });

  it('여러 행을 합산한다', () => {
    const rows = [
      pair(),
      pair({ before: info({ process_id: 'A' }) }),
      pair({ before: info({ process_id: 'A', sp: 'S', sd: 'D', pp: 'P' }), after: info({ process_id: 'B', sp: 'S', sd: 'D', pp: 'P' }) }),
    ];
    expect(validateMergePairs(rows)).toEqual({ incompleteCells: 3, blankRows: 1, validCount: 2 });
  });

  it('빈 배열이면 전부 0', () => {
    expect(validateMergePairs([])).toEqual({ incompleteCells: 0, blankRows: 0, validCount: 0 });
  });
});

describe('applyMergePaste', () => {
  const paste = (raw: string) => parseMergePasteRows(raw);
  const row = (n: number) => `A${n}\tSP${n}\tSD${n}\tPP${n}`;

  it('4열 10행을 변경전에 붙여넣으면 10행이 되고 변경후는 모두 미등록(삭제)이 된다', () => {
    const start = [emptyMergePair()];
    const raw = Array.from({ length: 10 }, (_, i) => row(i + 1)).join('\n');
    const next = applyMergePaste(start, start[0].id, 'before', paste(raw));
    expect(next).toHaveLength(10);
    expect(next.every((p) => p.after === null)).toBe(true);
    // 변경전만 채웠으므로 변경후가 미등록 → 판정은 '삭제'
    expect(next.every((p) => p.kind === 'deleted')).toBe(true);
    expect(next[0].before).toEqual({ process_id: 'A1', sp: 'SP1', sd: 'SD1', pp: 'PP1', layerid: '' });
    expect(next[9].before?.process_id).toBe('A10');
  });

  it('변경전 3행 상태에서 변경후 3번째 행에 4행을 붙여넣으면 6행이 되고 변경전도 함께 늘어난다', () => {
    // 변경전 3행 (요청 6번의 시나리오)
    const seed = [emptyMergePair()];
    const before3 = applyMergePaste(seed, seed[0].id, 'before', paste([row(1), row(2), row(3)].join('\n')));
    expect(before3).toHaveLength(3);

    // 변경후 3번째 행부터 4행 붙여넣기 → 3,4,5,6 행
    const after4 = applyMergePaste(before3, before3[2].id, 'after', paste([row(7), row(8), row(9), row(10)].join('\n')));
    expect(after4).toHaveLength(6);
    // 3번째 행은 양쪽 값이 있어 '변경'
    expect(after4[2].kind).toBe('changed');
    expect(after4[2].before?.process_id).toBe('A3');
    expect(after4[2].after?.process_id).toBe('A7');
    // 새로 생긴 4~6행은 변경전이 미등록 → '추가'
    expect(after4.slice(3).every((p) => p.before === null && p.kind === 'added')).toBe(true);
    // 1~2행은 그대로
    expect(after4[0].before?.process_id).toBe('A1');
    expect(after4[1].after).toBeNull();
  });

  it('새로 만든 행은 직전 행의 구분을 따라간다', () => {
    const seed = [{ ...emptyMergePair(), table: 'O' as const }];
    const next = applyMergePaste(seed, seed[0].id, 'before', paste([row(1), row(2)].join('\n')));
    expect(next.map((p) => p.table)).toEqual(['O', 'O']);
  });

  it('없는 행 id 나 빈 그리드면 원본을 그대로 돌려준다', () => {
    const seed = [emptyMergePair()];
    expect(applyMergePaste(seed, 'nope', 'before', paste(row(1)))).toBe(seed);
    expect(applyMergePaste(seed, seed[0].id, 'before', [])).toBe(seed);
  });

  it('열이 모자란 줄은 채운 칸만 덮어쓰고 나머지 값은 유지한다', () => {
    const seed = [emptyMergePair()];
    const filled = applyMergePaste(seed, seed[0].id, 'before', paste(row(1)));
    const partial = applyMergePaste(filled, filled[0].id, 'before', paste('B1\tSPX'));
    expect(partial[0].before).toEqual({ process_id: 'B1', sp: 'SPX', sd: 'SD1', pp: 'PP1', layerid: '' });
  });
});
