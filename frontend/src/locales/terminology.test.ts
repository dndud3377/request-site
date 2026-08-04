import { createInstance } from 'i18next';
import ko from './ko.json';
import en from './en.json';

/** 사내 정식 용어가 적히는 단일 소스 키 — 용어 교체는 여기 한 곳만 고친다. */
const TERM_KEY = 'request.validation_system' as const;

/** 위 용어를 `$t()` 로 참조해야 하는 파생 문구들 */
const DERIVED_KEYS = [
  'approval.validation_system_updated',
  'approval.route_diagram.note_e',
] as const;

/** 저장소에 커밋돼 있는 가명. 용어를 바꾼 뒤 파생 문구에 이 문자열이 남아 있으면 하드코딩된 것이다. */
const PLACEHOLDER_TERM = 'Validation System';

/** 용어 교체 시뮬레이션에 쓰는 센티넬 — 어떤 실제 문구와도 겹치지 않는 값 */
const SENTINEL_TERM = '__사내정식용어__';

/** 이 테스트가 필요로 하는 최소 형태. ko/en 의 전체 키 집합이 달라도 둘 다 만족한다. */
interface TermResource {
  request: { validation_system: string };
}

/** 주어진 리소스만으로 격리된 i18next 인스턴스를 만든다(앱 싱글턴을 오염시키지 않는다). */
const makeI18n = <T extends TermResource>(resource: T) => {
  const instance = createInstance();
  instance.init({
    lng: 'test',
    resources: { test: { translation: resource } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
};

/** 용어 키의 값만 바꾼 리소스 사본을 만든다. */
const withTerm = <T extends TermResource>(resource: T, term: string): T => ({
  ...resource,
  request: { ...resource.request, validation_system: term },
});

const describeLocale = (label: string, resource: TermResource) => {
  describe(`${label} — 사내 용어 단일 소스`, () => {
    it('파생 문구가 용어 키의 값을 그대로 포함한다', () => {
      const i18n = makeI18n(resource);
      const term = i18n.t(TERM_KEY);
      expect(term).not.toBe(TERM_KEY); // 키가 실재하는지(미존재 시 i18next 는 키를 그대로 반환)
      DERIVED_KEYS.forEach((key) => {
        expect(i18n.t(key)).toContain(term);
      });
    });

    it('용어 값만 바꾸면 파생 문구에 전파되고 옛 용어는 남지 않는다', () => {
      const i18n = makeI18n(withTerm(resource, SENTINEL_TERM));
      DERIVED_KEYS.forEach((key) => {
        const text = i18n.t(key);
        expect(text).toContain(SENTINEL_TERM);
        expect(text).not.toContain(PLACEHOLDER_TERM);
      });
    });
  });
};

describeLocale('ko.json', ko);
describeLocale('en.json', en);
