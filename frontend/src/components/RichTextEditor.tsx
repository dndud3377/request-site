import React, { useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle, Color, FontSize, BackgroundColor, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { uploadImageAPI } from '../api/client';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

const EMOJI_LIST = ['✅','⚠️','📌','💡','🔍','📝','🚨','✨','👉','❌','🎯','📊','🔧','📋','👆','🔺','📎','💬'];

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
  const textColorRef = useRef<HTMLInputElement>(null);
  const bgColorRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
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
      onChange(editor.getHTML());
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

  if (!editor) return null;

  const currentTextColor = editor.getAttributes('textStyle').color || '#000000';
  const currentBgColor = editor.getAttributes('textStyle').backgroundColor || '#ffff00';
  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || '';
  const currentFontSize = (editor.getAttributes('textStyle').fontSize as string | undefined)?.replace('px', '') || '';

  return (
    <div style={{ border: '1.5px solid #dde1ea', borderRadius: 10, overflow: 'hidden' }}>
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
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                title="글꼴 색"
                onMouseDown={(e) => { e.preventDefault(); textColorRef.current?.click(); }}
                style={{
                  padding: '3px 7px 2px',
                  border: '1px solid #dde1ea',
                  borderRadius: 5,
                  background: '#fff',
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
              <input
                ref={textColorRef}
                type="color"
                value={currentTextColor}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                onChange={(e) => {
                  (editor.chain().focus() as any).setColor(e.target.value).run();
                }}
              />
            </div>

            {/* 바탕색 */}
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                title="바탕색"
                onMouseDown={(e) => { e.preventDefault(); bgColorRef.current?.click(); }}
                style={{
                  padding: '3px 7px 2px',
                  border: '1px solid #dde1ea',
                  borderRadius: 5,
                  background: '#fff',
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
              <input
                ref={bgColorRef}
                type="color"
                value={currentBgColor}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                onChange={(e) => {
                  (editor.chain().focus() as any).setBackgroundColor(e.target.value).run();
                }}
              />
            </div>

            {/* 색상 초기화 */}
            <ToolbarBtn
              title="색상 초기화"
              onClick={() => {
                (editor.chain().focus() as any).unsetColor().unsetBackgroundColor().run();
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
      <div onPaste={handlePaste}>
        <EditorContent
          editor={editor}
          style={{
            minHeight: 160,
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
