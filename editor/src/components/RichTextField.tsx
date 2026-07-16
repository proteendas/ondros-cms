'use client';

/**
 * TipTap-based rich text field storing HTML strings in Entry.fields.
 * Extend the toolbar by adding TipTap extensions (Link, Image, Table…) to
 * `extensions` and a corresponding button below.
 */
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

interface Props {
  value: string;
  onChange: (html: string) => void;
}

export default function RichTextField({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || '<p></p>',
    // Required with Next.js SSR to avoid hydration mismatches.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sync external value changes (AI generation, inline edits from the preview)
  // into the editor without clobbering the cursor during normal typing.
  useEffect(() => {
    if (!editor) return;
    if (value && value !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) return <div className="muted">Loading editor…</div>;

  const btn = (label: string, action: () => void, active: boolean) => (
    <button
      type="button"
      className={active ? 'active' : ''}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
        action();
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="tiptap-toolbar">
        {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {btn(
          'H2',
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          editor.isActive('heading', { level: 2 }),
        )}
        {btn(
          'H3',
          () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          editor.isActive('heading', { level: 3 }),
        )}
        {btn('• List', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('1. List', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('“ ”', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {btn('↺', () => editor.chain().focus().undo().run(), false)}
        {btn('↻', () => editor.chain().focus().redo().run(), false)}
      </div>
      <div className="tiptap-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
