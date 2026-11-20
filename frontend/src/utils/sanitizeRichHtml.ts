// claude 수정 (2026-11-20): 저장형 XSS(B-26) 방어 — RichTextEditor 로 저장된 HTML 을 렌더 직전에
// 에디터와 같은 Tiptap(ProseMirror) 스키마로 재파싱해, 스키마에 없는 태그·속성(script, on*, iframe,
// javascript: 링크, 임의 style 속성 등)을 제거한다. 신규 의존성 없이 에디터가 만들 수 있는 것만 남긴다.
import { generateHTML, generateJSON } from '@tiptap/core';
import { RICH_TEXT_SCHEMA_EXTENSIONS } from '../components/richTextExtensions';

/**
 * dangerouslySetInnerHTML 에 넣기 전에 반드시 거친다.
 * 파싱에 실패하면 원문을 내보내지 않고 빈 문자열을 반환한다(fail-closed).
 */
export const sanitizeRichHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  try {
    return generateHTML(generateJSON(html, RICH_TEXT_SCHEMA_EXTENSIONS), RICH_TEXT_SCHEMA_EXTENSIONS);
  } catch {
    return '';
  }
};
