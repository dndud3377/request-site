import React, { useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle, Color, FontSize, BackgroundColor, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import { uploadImageAPI, uploadVideoAPI } from '../api/client';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// 동영상 업로드 최대 크기 (50MB)
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

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

// claude 수정 (2026-10-23): 저장 형식과 에디터 내부 형식을 분리해 왕복을 안정화한다.
// getHTML()은 빈 문단을 <p></p>로 직렬화해 <br>이 빠지므로, 표시 시 라인박스가 생기지 않아
// 빈 줄이 사라진다 → 저장할 때는 <p><br></p>로 보정한다. 반대로 <p><br></p>를 그대로 에디터에
// 넣으면 '줄바꿈 1개가 든 문단'으로 읽혀, 글을 끝까지 지우는 순간 setContent 가 다시 돌며
// 커서가 다음 줄로 튀고 빈 줄이 두 칸 높이가 되므로, 에디터에 넣을 때는 <p></p>로 되돌린다.
const toStoredHtml = (html: string): string => html.replace(/<p><\/p>/g, '<p><br></p>');
const toEditorHtml = (html: string): string => html.replace(/<p><br\s*\/?><\/p>/g, '<p></p>');

// 툴바 '표' 버튼으로 삽입하는 기본 표 크기(첫 행은 머리글)
const TABLE_INSERT_ROWS = 3;
const TABLE_INSERT_COLS = 3;

interface Props {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

// 에디터 본문 최소 높이(px). 높이를 직접 지정하지 않는 사용처(VOC 등록·공지 작성)의
// 입력칸 크기를 결정한다. 자체 높이를 갖는 사용처(가이드=flex, MAP 변경 사유=고정 높이)는
// 이 값보다 커서 영향을 받지 않는다.
const EDITOR_MIN_HEIGHT = 240;

const EMOJI_LIST =['✅','⚠️','📌','💡','🔍','📝','🚨','✨','👉','❌','🎯','📊','🔧','📋','👆','🔺','📎','💬'];

// ===== 엑셀 색상 팔레트 =====

const EXCEL_THEME_BASES = [
  '#FFFFFF', '#000000', '#EEECE1', '#1F497D',
  '#4F81BD', '#C0504D', '#9BBB59', '#8064A2',
  '#4BACC6', '#F79646',
];

export const EXCEL_STANDARD_COLORS = [
  '#C00000', '#FF0000', '#FFC000', '#FFFF00',
  '#92D050', '#00B050', '#00B0F0', '#0070C0',
  '#002060', '#7030A0',
];

const TINTS = [0, 0.8, 0.6, 0.4, -0.25, -0.5];

function applyTint(hex: string, tint: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 0xFF;
  const g = (num >> 8) & 0xFF;
  const b = num & 0xFF;
  const calc = (c: number) =>
    Math.max(0, Math.min(255, tint >= 0
      ? Math.round(c + (255 - c) * tint)
      : Math.round(c * (1 + tint))));
  return '#' + [calc(r), calc(g), calc(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// THEME_COLORS[row][col] — 6행 × 10열
const THEME_COLORS: string[][] = TINTS.map(t => EXCEL_THEME_BASES.map(c => applyTint(c, t)));

interface ColorPaletteProps {
  showNone?: boolean;
  onSelect: (color: string | null) => void;
}

/** 테마 색상/표준 색상 팔레트 — 공지 작성 등 이 에디터의 글자색·바탕색 선택 UI. J/O-layer
 * 색상 적용 기능(ApprovalPage)의 키워드별 색상 선택에도 그대로 재사용한다. */
export const ColorPalette: React.FC<ColorPaletteProps> = ({ showNone, onSelect }) => {
  const { t } = useTranslation();
  return (
  <div
    style={{
      position: 'absolute',
      top: '110%',
      left: 0,
      zIndex: 9999,
      background: '#fff',
      border: '1px solid #dde1ea',
      borderRadius: 6,
      padding: '8px 10px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      userSelect: 'none',
      minWidth: 192,
    }}
  >
    {showNone && (
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onSelect(null); }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#555', border: 'none', background: 'none', cursor: 'pointer', marginBottom: 6, padding: '2px 0' }}
      >
        <div style={{ width: 14, height: 14, border: '1px solid #ccc', background: 'repeating-linear-gradient(45deg,#fff,#fff 2px,#f88 2px,#f88 4px)', borderRadius: 2 }} />
        {t('editor.color_none')}
      </button>
    )}
    <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{t('editor.theme_colors')}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 16px)', gap: 2, marginBottom: 8 }}>
      {THEME_COLORS.flat().map((color, i) => (
        <div
          key={i}
          title={color}
          onMouseDown={(e) => { e.preventDefault(); onSelect(color); }}
          style={{ width: 16, height: 16, background: color, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', borderRadius: 1 }}
        />
      ))}
    </div>
    <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{t('editor.standard_colors')}</div>
    <div style={{ display: 'flex', gap: 2 }}>
      {EXCEL_STANDARD_COLORS.map(color => (
        <div
          key={color}
          title={color}
          onMouseDown={(e) => { e.preventDefault(); onSelect(color); }}
          style={{ width: 16, height: 16, background: color, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', borderRadius: 1 }}
        />
      ))}
    </div>
  </div>
  );
};

// label 은 화면 표시용(번역), value 는 실제 CSS font-family 값이므로 번역하지 않는다.
const FONT_FAMILIES = (t: TFunction) => [
  { label: t('editor.font_default'), value: '' },
  { label: t('editor.font_malgun'), value: '맑은 고딕, Malgun Gothic, sans-serif' },
  { label: t('editor.font_nanum'), value: '나눔고딕, NanumGothic, sans-serif' },
  { label: t('editor.font_gulim'), value: '굴림, Gulim, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
];

const FONT_SIZES = ['10', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48'];

const ToolbarBtn: React.FC<{
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    title={title}
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    style={{
      padding: '4px 8px',
      border: `1px solid ${active ? '#4f8ef7' : '#dde1ea'}`,
      borderRadius: 5,
      background: active ? '#eff6ff' : '#fff',
      color: active ? '#4f8ef7' : '#333',
      fontSize: 12,
      cursor: 'pointer',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      transition: 'all 0.15s',
    }}
  >
    {children}
  </button>
);

const ToolbarSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  title?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ value, onChange, title, style, children }) => (
  <select
    title={title}
    value={value}
    onMouseDown={(e) => e.stopPropagation()}
    onChange={(e) => onChange(e.target.value)}
    style={{
      padding: '3px 4px',
      border: '1px solid #dde1ea',
      borderRadius: 5,
      background: '#fff',
      color: '#333',
      fontSize: 12,
      cursor: 'pointer',
      height: 26,
      ...style,
    }}
  >
    {children}
  </select>
);

const Sep = () => (
  <div style={{ width: 1, background: '#dde1ea', margin: '0 3px', alignSelf: 'stretch', minHeight: 20 }} />
);

const RichTextEditor: React.FC<Props> = ({ value, onChange, readOnly = false, placeholder }) => {
  const { t } = useTranslation();
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [activeColorPicker, setActiveColorPicker] = React.useState<'text' | 'bg' | null>(null);
  const textColorBtnRef = useRef<HTMLDivElement>(null);
  const bgColorBtnRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!activeColorPicker) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!textColorBtnRef.current?.contains(t) && !bgColorBtnRef.current?.contains(t)) {
        setActiveColorPicker(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeColorPicker]);

  // claude 수정 (2026-10-23): 엑셀·워드 표 붙여넣기 보존용 TableKit 추가, StarterKit 에 이미 있는
  // Underline 중복 등록 제거, Enter=새 문단(Shift+Enter=줄바꿈, TipTap 기본)으로 되돌림
  // — Enter 를 <br>로 바꾸던 확장 때문에 글 전체가 한 문단이 되어 H1·정렬이 전체에 적용됐다.
  const editor = useEditor({
    extensions: [
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
      Placeholder.configure({ placeholder: placeholder || t('guide.editor_placeholder') }),
    ],
    content: toEditorHtml(value),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(toStoredHtml(editor.getHTML()));
    },
  });

  // claude 수정 (2026-10-23): 저장 형식끼리 비교 — 방금 onUpdate 로 내보낸 값이 되돌아왔을 때
  // setContent 가 다시 돌아 커서가 튀지 않도록 한다. 외부 value 변경 시에만 동기화.
  React.useEffect(() => {
    if (editor && value !== toStoredHtml(editor.getHTML())) {
      editor.commands.setContent(toEditorHtml(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // 이미지 붙여넣기
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (readOnly || !editor) return;
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((i) => i.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      try {
        const res = await uploadImageAPI.upload(file);
        const url = res.url;
        if (url) editor.chain().focus().setImage({ src: url }).run();
      } catch {
        // claude 수정 (2026-10-23): 실패를 무시하지 않고 알린다(동영상 업로드와 동일)
        window.alert(t('guide.image_upload_failed'));
      }
    },
    [editor, readOnly, t]
  );

  const handleImageUpload = useCallback(async () => {
    if (!editor) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const res = await uploadImageAPI.upload(file);
        const url = res.url;
        if (url) editor.chain().focus().setImage({ src: url }).run();
      } catch {
        // claude 수정 (2026-10-23): 실패를 무시하지 않고 알린다(동영상 업로드와 동일)
        window.alert(t('guide.image_upload_failed'));
      }
    };
    input.click();
  }, [editor, t]);

  const handleVideoUpload = useCallback(async () => {
    if (!editor) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_VIDEO_SIZE) {
        window.alert(t('guide.video_too_large'));
        return;
      }
      try {
        const res = await uploadVideoAPI.upload(file);
        const url = res.url;
        if (url) editor.chain().focus().insertContent({ type: 'video', attrs: { src: url } }).run();
      } catch {
        window.alert(t('guide.video_upload_failed'));
      }
    };
    input.click();
  }, [editor, t]);

  if (!editor) return null;

  const currentTextColor = editor.getAttributes('textStyle').color || '#000000';
  const currentBgColor = editor.getAttributes('textStyle').backgroundColor || '#ffff00';
  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || '';
  const currentFontSize = (editor.getAttributes('textStyle').fontSize as string | undefined)?.replace('px', '') || '';

  return (
    <div style={{ border: '1.5px solid #dde1ea', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {!readOnly && (
        <>
          {/* 툴바 1행: 서식 */}
          <div
            style={{
              display: 'flex',
              gap: 3,
              padding: '7px 10px 4px',
              background: '#f7f9fc',
              borderBottom: '1px solid #edf0f5',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <ToolbarBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t('editor.bold')}><b>B</b></ToolbarBtn>
            <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t('editor.italic')}><i>I</i></ToolbarBtn>
            <ToolbarBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t('editor.underline')}><u>U</u></ToolbarBtn>
            <Sep />
            <ToolbarBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarBtn>
            <ToolbarBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarBtn>
            <ToolbarBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarBtn>
            <Sep />
            <ToolbarBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title={t('editor.align_left_title')}>≡ {t('editor.align_left_label')}</ToolbarBtn>
            <ToolbarBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title={t('editor.align_center_title')}>≡ {t('editor.align_center_label')}</ToolbarBtn>
            <Sep />
            <ToolbarBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('editor.bullet_list_title')}>• {t('editor.list_label')}</ToolbarBtn>
            <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('editor.ordered_list_title')}>1. {t('editor.list_label')}</ToolbarBtn>
            <Sep />
            <ToolbarBtn onClick={() => setShowEmoji((v) => !v)} title={t('editor.emoji')}>😊 {t('editor.emoji')}</ToolbarBtn>
            <ToolbarBtn onClick={handleImageUpload} title={t('editor.image_upload_title')}>🖼 {t('editor.image_upload_label')}</ToolbarBtn>
            <ToolbarBtn onClick={handleVideoUpload} title={t('editor.video_upload_title')}>🎬 {t('editor.video_upload_label')}</ToolbarBtn>
          </div>

          {/* 툴바 2행: 글꼴 / 크기 / 색상 */}
          <div
            style={{
              display: 'flex',
              gap: 5,
              padding: '4px 10px 6px',
              background: '#f7f9fc',
              borderBottom: '1px solid #e8ecf2',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {/* 글꼴 */}
            <ToolbarSelect
              title={t('editor.font_family_title')}
              value={currentFontFamily}
              onChange={(v) => {
                if (v) {
                  (editor.chain().focus() as any).setFontFamily(v).run();
                } else {
                  (editor.chain().focus() as any).unsetFontFamily().run();
                }
              }}
              style={{ width: 120 }}
            >
              {FONT_FAMILIES(t).map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </ToolbarSelect>

            {/* 글꼴 크기 */}
            <ToolbarSelect
              title={t('editor.font_size_title')}
              value={currentFontSize}
              onChange={(v) => {
                if (v) {
                  (editor.chain().focus() as any).setFontSize(`${v}px`).run();
                } else {
                  (editor.chain().focus() as any).unsetFontSize().run();
                }
              }}
              style={{ width: 62 }}
            >
              <option value="">{t('editor.font_size_placeholder')}</option>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </ToolbarSelect>

            <Sep />

            {/* 글꼴 색 */}
            <div ref={textColorBtnRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                title={t('editor.font_color_title')}
                onMouseDown={(e) => { e.preventDefault(); setActiveColorPicker(v => v === 'text' ? null : 'text'); }}
                style={{
                  padding: '3px 7px 2px',
                  border: `1px solid ${activeColorPicker === 'text' ? '#4f8ef7' : '#dde1ea'}`,
                  borderRadius: 5,
                  background: activeColorPicker === 'text' ? '#eff6ff' : '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1,
                  lineHeight: 1,
                }}
              >
                <span style={{ color: currentTextColor }}>A</span>
                <span style={{ display: 'block', width: 14, height: 3, background: currentTextColor, borderRadius: 1 }} />
              </button>
              {activeColorPicker === 'text' && (
                <ColorPalette
                  onSelect={(color) => {
                    if (color) (editor.chain().focus() as any).setColor(color).run();
                    else (editor.chain().focus() as any).unsetColor().run();
                    setActiveColorPicker(null);
                  }}
                />
              )}
            </div>

            {/* 바탕색 */}
            <div ref={bgColorBtnRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                title={t('editor.bg_color_title')}
                onMouseDown={(e) => { e.preventDefault(); setActiveColorPicker(v => v === 'bg' ? null : 'bg'); }}
                style={{
                  padding: '3px 7px 2px',
                  border: `1px solid ${activeColorPicker === 'bg' ? '#4f8ef7' : '#dde1ea'}`,
                  borderRadius: 5,
                  background: activeColorPicker === 'bg' ? '#eff6ff' : '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1,
                  lineHeight: 1,
                }}
              >
                <span style={{ background: currentBgColor, padding: '0 2px', borderRadius: 2, color: '#333', fontSize: 11 }}>AB</span>
                <span style={{ display: 'block', width: 14, height: 3, background: currentBgColor, borderRadius: 1 }} />
              </button>
              {activeColorPicker === 'bg' && (
                <ColorPalette
                  showNone
                  onSelect={(color) => {
                    if (color) (editor.chain().focus() as any).setBackgroundColor(color).run();
                    else (editor.chain().focus() as any).unsetBackgroundColor().run();
                    setActiveColorPicker(null);
                  }}
                />
              )}
            </div>

            {/* 색상 초기화 */}
            <ToolbarBtn
              title={t('editor.reset_color_title')}
              onClick={() => {
                (editor.chain().focus() as any).unsetColor().unsetBackgroundColor().run();
                setActiveColorPicker(null);
              }}
            >
              <span style={{ fontSize: 11 }}>{t('editor.reset_color_label')}</span>
            </ToolbarBtn>

            {/* claude 수정 (2026-10-23): 표 삽입·행/열 추가·삭제. 표 밖에서 누르면 명령이 실행되지 않는다(no-op). */}
            <Sep />
            <ToolbarBtn
              title={t('editor.table_insert_title')}
              onClick={() => editor.chain().focus().insertTable({ rows: TABLE_INSERT_ROWS, cols: TABLE_INSERT_COLS, withHeaderRow: true }).run()}
            >
              ▦ {t('editor.table_insert_label')}
            </ToolbarBtn>
            <ToolbarBtn title={t('editor.table_add_row_title')} onClick={() => editor.chain().focus().addRowAfter().run()}>{t('editor.table_add_row_label')}</ToolbarBtn>
            <ToolbarBtn title={t('editor.table_delete_row_title')} onClick={() => editor.chain().focus().deleteRow().run()}>{t('editor.table_delete_row_label')}</ToolbarBtn>
            <ToolbarBtn title={t('editor.table_add_col_title')} onClick={() => editor.chain().focus().addColumnAfter().run()}>{t('editor.table_add_col_label')}</ToolbarBtn>
            <ToolbarBtn title={t('editor.table_delete_col_title')} onClick={() => editor.chain().focus().deleteColumn().run()}>{t('editor.table_delete_col_label')}</ToolbarBtn>
            <ToolbarBtn title={t('editor.table_delete_title')} onClick={() => editor.chain().focus().deleteTable().run()}>{t('editor.table_delete_label')}</ToolbarBtn>
          </div>

          {/* 이모티콘 팝업 */}
          {showEmoji && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                padding: '8px 10px',
                background: '#fff',
                borderBottom: '1px solid #e8ecf2',
              }}
            >
              {EMOJI_LIST.map((emoji) => (
                <span
                  key={emoji}
                  style={{ fontSize: 20, cursor: 'pointer', padding: 2, borderRadius: 4 }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editor.chain().focus().insertContent(emoji).run();
                    setShowEmoji(false);
                  }}
                >
                  {emoji}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* 에디터 본문 */}
      <div onPaste={handlePaste} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <EditorContent
          editor={editor}
          style={{
            minHeight: EDITOR_MIN_HEIGHT,
            padding: '12px 14px',
            fontSize: 14,
            lineHeight: 1.7,
            background: '#fafbff',
            outline: 'none',
          }}
        />
      </div>

      {!readOnly && (
        <div style={{ padding: '4px 10px 6px', fontSize: 11, color: '#aaa', background: '#f7f9fc', borderTop: '1px solid #e8ecf2' }}>
          📎 {t('guide.paste_image_hint')}
        </div>
      )}
    </div>
  );
};

export default RichTextEditor;
