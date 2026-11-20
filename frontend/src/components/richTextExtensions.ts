// claude 수정 (2026-11-20): RichTextEditor 의 문서 스키마(extension 목록)를 분리 — 에디터와
// 렌더 시 HTML 정화(utils/sanitizeRichHtml)가 같은 화이트리스트를 쓰도록 한 곳에서 정의한다(B-26).
import { Node as TiptapNode, mergeAttributes, Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle, Color, FontSize, BackgroundColor, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';

// 가이드 동영상용 커스텀 노드 — <video controls> 로 렌더링
const Video = TiptapNode.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'video' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        controls: 'controls',
        style: 'max-width:100%;border-radius:8px;',
      }),
    ];
  },
});

/**
 * 저장 HTML 의 스키마를 정하는 extension 목록. 여기 등록된 노드·마크·속성만 저장·렌더된다.
 * 에디터 전용 동작(Placeholder 등)은 넣지 않는다 — 스키마에 영향이 없고 렌더 정화에는 불필요하다.
 */
export const RICH_TEXT_SCHEMA_EXTENSIONS: Extensions = [
  StarterKit,
  TableKit.configure({ table: { resizable: false } }),
  Image.configure({ inline: false, allowBase64: false }),
  Video,
  TextStyle,
  Color,
  FontSize,
  BackgroundColor,
  FontFamily,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];
