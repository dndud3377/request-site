import React, { useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Node as TiptapNode, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle, Color, FontSize, BackgroundColor, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { uploadImageAPI, uploadVideoAPI } from '../api/client';
import { useTranslation } from 'react-i18next';

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

// Enter 를 문단 분리 대신 한 줄 개행(<br>)으로 처리한다.
// 단, 목록/코드블록 안에서는 기본 동작(항목 추가 등)을 유지한다.
const EnterAsHardBreak = Extension.create({
  name: 'enterAsHardBreak',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { editor } = this;
        if (
          editor.isActive('bulletList') ||
          editor.isActive('orderedList') ||
          editor.isActive('listItem') ||
          editor.isActive('codeBlock')
        ) {
          return false; // 기본 Enter 동작에 위임
        }
        return editor.commands.setHardBreak();
      },
    };
  },
});

interface Props {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

const EMOJI_LIST = ['✅','⚠️','📌','💡','🔍','📝','🚨','✨','👉','❌','🎯','📊','🔧','📋','👆','🔺','📎','💬'];

// ===== 엑셀 색상 팔레트 =====

const EXCEL_THEME_BASES = [
  '#FFFFFF', '#000000', '#EEECE1', '#1F497D',
  '#4F81BD', '#C0504D', '#9BBB59', '#8064A2',
  '#4BACC6', '#F79646',
];

const EXCEL_STANDARD_COLORS = [
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

const ColorPalette: React.FC<ColorPaletteProps> = ({ showNone, onSelect }) => (
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
        색 없음
      </button>
    )}
    <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>테마 색상</div>
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
    <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>표준 색상</div>
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

const FONT_FAMILIES = [
  { label: '기본', value: '' },
  { label: '맑은 고딕', value: '맑은 고딕, Malgun Gothic, sans-serif' },
  { label: '나눔고딕', value: '나눔고딕, NanumGothic, sans-serif' },
  { label: '굴림', value: '굴림, Gulim, sans-serif' },
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

  const editor = useEditor({
    extensions: [
      StarterKit,
      EnterAsHardBreak,
      Image.configure({ inline: false, allowBase64: false }),
      Video,
      TextStyle,
      Color,
      FontSize,
      BackgroundColor,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      Placeholder.configure({ placeholder: placeholder || t('guide.editor_placeholder') }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // getHTML()은 빈 문단을 <p></p>로 직렬화해 <br>이 빠지므로,
      // 표시 시 라인박스가 생기지 않아 빈 줄이 사라진다. <br>을 채워 보정.
      const html = editor.getHTML().replace(/<p><\/p>/g, '<p><br></p>');
      onChange(html);
    },
  });

  // 외부 value 변경 시 동기화
  React.useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
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
        // 업로드 실패 시 무시
      }
    },
    [editor, readOnly]
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
        // 업로드 실패 시 무시
      }
    };
    input.click();
  }, [editor]);

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
            <ToolbarBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게"><b>B</b></ToolbarBtn>
            <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="기울임"><i>I</i></ToolbarBtn>
            <ToolbarBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄"><u>U</u></ToolbarBtn>
            <Sep />
            <ToolbarBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarBtn>
            <ToolbarBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarBtn>
            <ToolbarBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarBtn>
            <Sep />
            <ToolbarBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="왼쪽 정렬">≡ 좌</ToolbarBtn>
            <ToolbarBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="가운데 정렬">≡ 중</ToolbarBtn>
            <Sep />
            <ToolbarBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="불릿 목록">• 목록</ToolbarBtn>
            <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 목록">1. 목록</ToolbarBtn>
            <Sep />
            <ToolbarBtn onClick={() => setShowEmoji((v) => !v)} title="이모티콘">😊 이모티콘</ToolbarBtn>
            <ToolbarBtn onClick={handleImageUpload} title="이미지 업로드">🖼 이미지</ToolbarBtn>
            <ToolbarBtn onClick={handleVideoUpload} title="동영상 업로드">🎬 동영상</ToolbarBtn>
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
              title="글꼴"
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
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </ToolbarSelect>

            {/* 글꼴 크기 */}
            <ToolbarSelect
              title="글꼴 크기"
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
              <option value="">크기</option>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </ToolbarSelect>

            <Sep />

            {/* 글꼴 색 */}
            <div ref={textColorBtnRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                title="글꼴 색"
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
                title="바탕색"
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
              title="색상 초기화"
              onClick={() => {
                (editor.chain().focus() as any).unsetColor().unsetBackgroundColor().run();
                setActiveColorPicker(null);
              }}
            >
              <span style={{ fontSize: 11 }}>색 초기화</span>
            </ToolbarBtn>
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
            minHeight: 120,
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
