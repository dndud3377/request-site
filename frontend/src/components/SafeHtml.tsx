import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';

/**
 * 서버에 저장된 HTML(VOC 본문·댓글, 가이드, 공지, 의뢰서 MAP 변경 사유)을 **정제한 뒤** 렌더링한다.
 *
 * ⚠️ 이 컴포넌트를 거치지 않고 dangerouslySetInnerHTML 을 직접 쓰지 말 것.
 *    입력 UI(RichTextEditor)가 안전한 태그만 만들더라도, API 를 직접 호출하면 임의 HTML 을
 *    저장할 수 있다. 그렇게 저장된 스크립트는 그 문서를 여는 모든 사람(결재 화면을 보는
 *    MASTER·TE_* 담당자 포함)의 브라우저에서 같은 오리진 권한으로 실행된다.
 *    상세: docs/SECURITY.md H-9.
 *
 * 허용 목록은 RichTextEditor(TipTap StarterKit + Underline/TextAlign/TextStyle/FontFamily/
 * Image + 커스텀 video 노드)가 실제로 만들어 내는 것에 맞췄다. 에디터에 서식을 추가하면
 * 여기에도 함께 추가해야 한다 — 빠뜨리면 그 서식이 화면에서 사라진다.
 */

/** 에디터가 만들어 내는 태그. 이 목록에 없는 태그는 제거된다(내용 텍스트는 남는다). */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img', 'video',
];

/**
 * 허용 속성.
 * `style` 은 정렬·글자색·글꼴을 담고 있어 빼면 서식이 깨진다. 다만 DOMPurify 는 style **값**까지
 * 파싱해 주지는 않으므로(확인: `style="background:url(javascript:...)"` 가 그대로 통과했다),
 * 아래 sanitizeStyle 훅에서 CSS 속성 화이트리스트로 다시 거른다.
 * `on*` 이벤트 핸들러는 이 목록에 없으므로 전부 제거된다.
 */
const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'src', 'alt', 'width', 'height', 'controls',
  'style', 'class', 'colspan', 'rowspan',
];

/**
 * style 속성에서 허용할 CSS 속성. 에디터(TextStyle/TextAlign/FontFamily, 커스텀 video 노드)가
 * 실제로 붙이는 것만 남긴다. 여기 없는 속성은 통째로 버린다.
 */
const ALLOWED_CSS_PROPS = new Set([
  'text-align', 'color', 'background-color', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-decoration', 'line-height',
  'max-width', 'width', 'height', 'border-radius',
]);

/** CSS 값에 들어오면 무조건 버리는 패턴 — 외부 리소스 로딩·구형 브라우저 스크립트 실행 경로. */
const UNSAFE_CSS_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|\\/i;

/**
 * style 속성값을 선언 단위로 걸러 안전한 것만 남긴다.
 * 남길 선언이 하나도 없으면 빈 문자열을 반환한다(호출부가 속성 자체를 지운다).
 */
function sanitizeStyle(value: string): string {
  return value
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return '';
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!ALLOWED_CSS_PROPS.has(prop)) return '';
      if (!val || UNSAFE_CSS_VALUE.test(val)) return '';
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(';');
}

const PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  // javascript: 등 실행 가능한 스킴을 막는다(data: 는 에디터가 붙여넣은 이미지에 쓰인다).
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/(?:png|jpe?g|gif|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  // ⚠️ USE_PROFILES 를 넣지 말 것. 넣으면 위 ALLOWED_TAGS/ALLOWED_ATTR 를 **덮어쓰고**
  //    프로필 기본 목록이 적용된다(확인: target 속성이 사라지고 허용목록이 무시됐다).
  //    svg/math 는 ALLOWED_TAGS 에 없으므로 이미 제거된다.
};

/**
 * 태그·속성 정제가 끝난 뒤 두 가지를 더 손본다.
 *  1) style 값을 CSS 속성 화이트리스트로 거른다(DOMPurify 는 값까지 파싱하지 않는다).
 *  2) 새 탭으로 열리는 링크에 rel="noopener noreferrer" 를 강제한다 - target="_blank" 만
 *     있으면 열린 페이지가 window.opener 로 원래 탭을 조작할 수 있다.
 */
let hookRegistered = false;
function ensureHook(): void {
  if (hookRegistered) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    const style = node.getAttribute('style');
    if (style !== null) {
      const safe = sanitizeStyle(style);
      if (safe) node.setAttribute('style', safe);
      else node.removeAttribute('style');
    }
    if (node.tagName === 'A' && node.getAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookRegistered = true;
}

/** 저장된 HTML 을 정제해 문자열로 돌려준다. 렌더링은 SafeHtml 을 쓰는 편이 낫다. */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  ensureHook();
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

/**
 * 저장된 HTML 에서 태그를 모두 걷어내고 텍스트만 남긴다(목록 미리보기·엑셀 내보내기용).
 * 정규식으로 태그를 지우는 방식은 `<img src="x>" onerror=...>` 같은 입력에서 새므로 쓰지 않는다.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  ensureHook();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as unknown as string;
}

interface SafeHtmlProps {
  /** 서버에 저장된 HTML. null/undefined 면 아무것도 렌더링하지 않는다. */
  html: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}

export default function SafeHtml({ html, className, style }: SafeHtmlProps): React.ReactElement {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: clean }} />;
}
