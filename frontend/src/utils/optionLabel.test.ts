import { createInstance } from 'i18next';
import ko from '../locales/ko.json';
import en from '../locales/en.json';
import { optionLabel, mapTypeLabel } from './optionLabel';

const makeT = (lng: 'ko' | 'en') => {
  const instance = createInstance();
  instance.init({
    lng,
    resources: { ko: { translation: ko }, en: { translation: en } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance.t.bind(instance) as unknown as Parameters<typeof optionLabel>[0];
};

describe('optionLabel', () => {
  it('한국어에서는 저장값 그대로 보인다', () => {
    const t = makeT('ko');
    expect(optionLabel(t, '신규+차용', 'purpose')).toBe('신규+차용');
    expect(optionLabel(t, 'MAP 삭제', 'purpose')).toBe('MAP 삭제');
    expect(optionLabel(t, '기등록', 'noc')).toBe('기등록');
  });

  it('영어에서는 요청 목적·기타 목적·요청 기준·라인을 번역한다', () => {
    const t = makeT('en');
    expect(optionLabel(t, '신규', 'purpose')).toBe('New');
    expect(optionLabel(t, '신규+차용', 'purpose')).toBe('New + Borrow');
    expect(optionLabel(t, '기타', 'purpose')).toBe('Other');
    expect(optionLabel(t, 'Layer 추가/삭제')).toBe('Layer Add/Delete');
    expect(optionLabel(t, '기등록', 'noc')).toBe('Pre-registered');
    expect(optionLabel(t, 'layer삭제', 'noc')).toBe('Layer-deleted');
    expect(optionLabel(t, '라인1')).toBe('Line 1');
  });

  it('같은 글자라도 종류에 따라 다른 문구를 쓴다 — 요청 목적 차용 vs 요청 기준 차용', () => {
    const t = makeT('en');
    expect(optionLabel(t, '차용', 'purpose')).toBe('Borrow');
    expect(optionLabel(t, '차용', 'noc')).toBe('Borrow');
  });

  it('모르는 값·빈 값은 원문 그대로 돌려준다(마스터 데이터 라인 등)', () => {
    const t = makeT('en');
    expect(optionLabel(t, 'FAB-X')).toBe('FAB-X');
    expect(optionLabel(t, '')).toBe('');
  });

  it("map_type 은 한글로 저장되는 '삭제' 만 번역한다", () => {
    const t = makeT('en');
    expect(mapTypeLabel(t, '삭제')).toBe('Delete');
    expect(mapTypeLabel(t, 'CLONE')).toBe('CLONE');
  });
});
