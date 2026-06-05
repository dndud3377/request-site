import React, { useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
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

const Sep = () => (
  <div style={{ width: 1, background: '#dde1ea', margin: '0 3px', alignSelf: 'stretch', minHeight: 20 }} />
);

const RichTextEditor: React.FC<Props> = ({ value, onChange, readOnly = false, placeholder }) => {
  const { t } = useTranslation();
  const [showEmoji, setShowEmoji] = React.useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      TextStyle,
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

  // 외부 value 변경 시 동기화 (수정 모드 진입 시)
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

  return (
    <div style={{ border: '1.5px solid #dde1ea', borderRadius: 10, overflow: 'hidden' }}>
      {!readOnly && (
        <>
          {/* 툴바 */}
          <div
            style={{
              display: 'flex',
              gap: 3,
              padding: '7px 10px',
              background: '#f7f9fc',
              borderBottom: '1px solid #e8ecf2',
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
