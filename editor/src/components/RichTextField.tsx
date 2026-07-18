'use client';

/**
 * TipTap rich text editor (spec 015). Stores a versioned ProseMirror JSON
 * document (not HTML). Legacy HTML-string values are parsed on load and
 * upgraded to JSON on the next edit.
 *
 * Features: bold/italic/underline/strike/code, H1–H6, lists, blockquote,
 * code block, rule, text color + highlight (swatch popovers), tables,
 * external + internal (entry/asset) links, embedded entries (block + inline)
 * and assets, and a "/" slash command menu. A field's `rich_text` config
 * hides disallowed controls; the backend re-checks on publish.
 */
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';

import Icon from '@/components/ui/Icon';
import type { ContentType } from '@/lib/types';

import { MediaPickerModal } from './MediaPicker';
import { ReferenceSearchModal } from './ReferencePicker';
import { EmbedProvider, type EmbedBridge } from './richtext/EmbedContext';
import {
  EmbeddedAssetBlock,
  EmbeddedEntryBlock,
  EmbeddedEntryInline,
  LinkedAsset,
  LinkedEntry,
} from './richtext/nodes';
import { SlashCommands, type SlashCommand } from './richtext/slash';
import {
  HIGHLIGHT_SWATCHES,
  TEXT_SWATCHES,
  docToValue,
  markAllowed,
  nodeAllowed,
  valueToContent,
  withConfigDefaults,
  type RichTextConfig,
  type RichTextValue,
} from './richtext/config';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface Props {
  value: RichTextValue;
  onChange: (value: RichTextValue) => void;
  config?: RichTextConfig | null;
  envPath: string;
  spacePath: string;
  allTypes: ContentType[];
  defaultLocale: string;
}

type PickerRequest =
  | { kind: 'entry'; allowed: string[]; apply: (id: string) => void }
  | { kind: 'asset'; apply: (id: string) => void };

/** Relative luminance + contrast ratio (WCAG) for the low-contrast warning. */
function contrastOnWhite(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 21;
  const n = parseInt(m[1], 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  return 1.05 / (lum + 0.05);
}

export default function RichTextField({
  value,
  onChange,
  config,
  envPath,
  spacePath,
  allTypes,
  defaultLocale,
}: Props) {
  const cfg = useMemo(() => withConfigDefaults(config), [config]);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const bridgeRef = useRef<EmbedBridge | null>(null);

  const extensions = useMemo(() => {
    const list: any[] = [
      StarterKit.configure({
        heading: nodeAllowed(cfg, 'heading') ? { levels: [1, 2, 3, 4, 5, 6] } : false,
        blockquote: nodeAllowed(cfg, 'blockquote') ? undefined : false,
        bulletList: nodeAllowed(cfg, 'bulletList') ? undefined : false,
        orderedList: nodeAllowed(cfg, 'orderedList') ? undefined : false,
        codeBlock: nodeAllowed(cfg, 'codeBlock') ? undefined : false,
        horizontalRule: nodeAllowed(cfg, 'horizontalRule') ? undefined : false,
        bold: markAllowed(cfg, 'bold') ? undefined : false,
        italic: markAllowed(cfg, 'italic') ? undefined : false,
        strike: markAllowed(cfg, 'strike') ? undefined : false,
        code: markAllowed(cfg, 'code') ? undefined : false,
      }),
    ];
    if (markAllowed(cfg, 'underline')) list.push(Underline);
    if (cfg.allow_color) list.push(TextStyle, Color);
    if (cfg.allow_highlight) list.push(Highlight.configure({ multicolor: true }));
    if (cfg.allow_links) {
      list.push(Link.configure({ openOnClick: false, autolink: true }), LinkedEntry, LinkedAsset);
    }
    if (cfg.allow_tables) {
      list.push(Table.configure({ resizable: true }), TableRow, TableHeader, TableCell);
    }
    list.push(
      EmbeddedEntryBlock,
      EmbeddedEntryInline,
      EmbeddedAssetBlock,
      SlashCommands.configure({ commands: (query: string) => slashCommands(query) }),
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const editor = useEditor({
    extensions,
    content: valueToContent(value),
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(docToValue(editor.getJSON())),
  });

  // Keep a live bridge for the embed NodeViews (open pickers to swap targets).
  bridgeRef.current = {
    apiUrl: API_URL,
    envPath,
    spacePath,
    types: allTypes,
    defaultLocale,
    requestEntry: (apply) => setPicker({ kind: 'entry', allowed: cfg.allowed_embed_types, apply }),
    requestAsset: (apply) => setPicker({ kind: 'asset', apply }),
  };

  // Sync external value changes (AI generation, inline edits) without clobbering
  // the cursor while typing.
  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const incoming = JSON.stringify(valueToContent(value));
    const current = JSON.stringify(editor.getJSON());
    if (incoming !== current) editor.commands.setContent(valueToContent(value), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  // NOTE: must not close over `editor` (it is null when `extensions` is first
  // memoized). Run handlers receive the editor as a parameter instead.
  function slashCommands(query: string): SlashCommand[] {
    const all: SlashCommand[] = [];
    const push = (title: string, hint: string, keywords: string[], run: SlashCommand['run']) =>
      all.push({ title, hint, keywords, run });

    if (nodeAllowed(cfg, 'heading')) {
      [1, 2, 3].forEach((level) =>
        push(`Heading ${level}`, `H${level} section title`, ['heading', `h${level}`], (e, r) =>
          e.chain().focus().deleteRange(r).toggleHeading({ level: level as 1 | 2 | 3 }).run(),
        ),
      );
    }
    if (nodeAllowed(cfg, 'bulletList'))
      push('Bullet list', 'Unordered list', ['ul', 'bullet', 'list'], (e, r) =>
        e.chain().focus().deleteRange(r).toggleBulletList().run());
    if (nodeAllowed(cfg, 'orderedList'))
      push('Numbered list', 'Ordered list', ['ol', 'number', 'list'], (e, r) =>
        e.chain().focus().deleteRange(r).toggleOrderedList().run());
    if (nodeAllowed(cfg, 'blockquote'))
      push('Quote', 'Block quote', ['quote', 'blockquote'], (e, r) =>
        e.chain().focus().deleteRange(r).toggleBlockquote().run());
    if (nodeAllowed(cfg, 'codeBlock'))
      push('Code block', 'Preformatted code', ['code', 'pre'], (e, r) =>
        e.chain().focus().deleteRange(r).toggleCodeBlock().run());
    if (nodeAllowed(cfg, 'horizontalRule'))
      push('Divider', 'Horizontal rule', ['hr', 'divider', 'rule'], (e, r) =>
        e.chain().focus().deleteRange(r).setHorizontalRule().run());
    if (cfg.allow_tables)
      push('Table', 'Insert a 3×3 table', ['table', 'grid'], (e, r) =>
        e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
    push('Embed entry (block)', 'Reference an entry as a block', ['embed', 'entry', 'ref'], (e, r) => {
      e.chain().focus().deleteRange(r).run();
      bridgeRef.current?.requestEntry((id) =>
        e.chain().focus().insertContent({ type: 'embeddedEntryBlock', attrs: { id } }).run());
    });
    push('Embed entry (inline)', 'Reference an entry inline', ['inline', 'entry', 'pill'], (e, r) => {
      e.chain().focus().deleteRange(r).run();
      bridgeRef.current?.requestEntry((id) =>
        e.chain().focus().insertContent({ type: 'embeddedEntryInline', attrs: { id } }).run());
    });
    push('Embed asset', 'Insert a media asset', ['asset', 'media', 'image'], (e, r) => {
      e.chain().focus().deleteRange(r).run();
      bridgeRef.current?.requestAsset((id) =>
        e.chain().focus().insertContent({ type: 'embeddedAssetBlock', attrs: { id } }).run());
    });

    const q = query.toLowerCase();
    return q
      ? all.filter((c) => c.title.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)))
      : all;
  }

  if (!editor) return <div className="muted">Loading editor…</div>;

  return (
    <EmbedProvider value={bridgeRef.current}>
      <div className="tiptap-field">
        <Toolbar editor={editor} cfg={cfg} bridge={bridgeRef.current} />
        <div className="tiptap-content">
          <EditorContent editor={editor} />
        </div>
      </div>

      {picker?.kind === 'entry' && (
        <ReferenceSearchModal
          envPath={envPath}
          types={allTypes}
          allowedContentTypes={picker.allowed}
          excludeIds={[]}
          defaultLocale={defaultLocale}
          onClose={() => setPicker(null)}
          onPick={(entry) => {
            picker.apply(entry.id);
            setPicker(null);
          }}
        />
      )}
      {picker?.kind === 'asset' && (
        <MediaPickerModal
          spacePath={spacePath}
          envPath={envPath}
          onClose={() => setPicker(null)}
          onPick={(asset) => {
            picker.apply(asset.id);
            setPicker(null);
          }}
        />
      )}
    </EmbedProvider>
  );
}

function Toolbar({ editor, cfg, bridge }: { editor: Editor; cfg: ReturnType<typeof withConfigDefaults>; bridge: EmbedBridge | null }) {
  const [openMenu, setOpenMenu] = useState<null | 'color' | 'highlight' | 'table' | 'insert' | 'link'>(null);
  const inTable = editor.isActive('table');

  const btn = (icon: React.ReactNode, action: () => void, active = false, title?: string, disabled = false) => (
    <button
      type="button"
      className={active ? 'active' : ''}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        action();
      }}
    >
      {icon}
    </button>
  );

  function setExternalLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className="tiptap-toolbar" onMouseLeave={() => setOpenMenu(null)}>
      {markAllowed(cfg, 'bold') && btn(<strong>B</strong>, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Bold')}
      {markAllowed(cfg, 'italic') && btn(<em>I</em>, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'Italic')}
      {markAllowed(cfg, 'underline') && btn(<span style={{ textDecoration: 'underline' }}>U</span>, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Underline')}
      {markAllowed(cfg, 'strike') && btn(<span style={{ textDecoration: 'line-through' }}>S</span>, () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), 'Strikethrough')}
      {markAllowed(cfg, 'code') && btn(<span className="mono">{'</>'}</span>, () => editor.chain().focus().toggleCode().run(), editor.isActive('code'), 'Inline code')}

      <span className="tt-sep" />

      {nodeAllowed(cfg, 'heading') && (
        <select
          className="tt-select"
          title="Text style"
          value={
            editor.isActive('heading', { level: 1 }) ? 'h1'
              : editor.isActive('heading', { level: 2 }) ? 'h2'
              : editor.isActive('heading', { level: 3 }) ? 'h3'
              : editor.isActive('heading', { level: 4 }) ? 'h4'
              : editor.isActive('heading', { level: 5 }) ? 'h5'
              : editor.isActive('heading', { level: 6 }) ? 'h6'
              : 'p'
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }}
        >
          <option value="p">Paragraph</option>
          {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={`h${l}`}>Heading {l}</option>)}
        </select>
      )}

      {nodeAllowed(cfg, 'bulletList') && btn(<Icon name="content" size={13} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Bullet list')}
      {nodeAllowed(cfg, 'orderedList') && btn(<span style={{ fontSize: 12 }}>1.</span>, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbered list')}
      {nodeAllowed(cfg, 'blockquote') && btn(<span style={{ fontSize: 15 }}>&ldquo;</span>, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), 'Quote')}
      {nodeAllowed(cfg, 'codeBlock') && btn(<span className="mono" style={{ fontSize: 11 }}>{'{ }'}</span>, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'), 'Code block')}
      {nodeAllowed(cfg, 'horizontalRule') && btn(<span>—</span>, () => editor.chain().focus().setHorizontalRule().run(), false, 'Divider')}

      {cfg.allow_color && (
        <span className="tt-sep" />
      )}
      {cfg.allow_color && (
        <div className="tt-menu-wrap">
          {btn(<Icon name="palette" size={14} />, () => setOpenMenu(openMenu === 'color' ? null : 'color'), editor.isActive('textStyle'), 'Text color')}
          {openMenu === 'color' && (
            <SwatchPopover
              swatches={TEXT_SWATCHES}
              current={editor.getAttributes('textStyle').color}
              onPick={(c) => { editor.chain().focus().setColor(c).run(); setOpenMenu(null); }}
              onClear={() => { editor.chain().focus().unsetColor().run(); setOpenMenu(null); }}
              warnLowContrast
            />
          )}
        </div>
      )}
      {cfg.allow_highlight && (
        <div className="tt-menu-wrap">
          {btn(<Icon name="highlighter" size={14} />, () => setOpenMenu(openMenu === 'highlight' ? null : 'highlight'), editor.isActive('highlight'), 'Highlight')}
          {openMenu === 'highlight' && (
            <SwatchPopover
              swatches={HIGHLIGHT_SWATCHES}
              current={editor.getAttributes('highlight').color}
              onPick={(c) => { editor.chain().focus().toggleHighlight({ color: c }).run(); setOpenMenu(null); }}
              onClear={() => { editor.chain().focus().unsetHighlight().run(); setOpenMenu(null); }}
            />
          )}
        </div>
      )}

      {cfg.allow_links && (
        <>
          <span className="tt-sep" />
          {btn(<Icon name="link" size={14} />, setExternalLink, editor.isActive('link'), 'External link')}
          {btn(<Icon name="field-reference" size={13} />, () => bridge?.requestEntry((id) => editor.chain().focus().setMark('linkedEntry', { id }).run()), editor.isActive('linkedEntry'), 'Link to entry')}
        </>
      )}

      {cfg.allow_tables && (
        <>
          <span className="tt-sep" />
          <div className="tt-menu-wrap">
            {btn(<Icon name="table" size={14} />, () => setOpenMenu(openMenu === 'table' ? null : 'table'), inTable, 'Table')}
            {openMenu === 'table' && (
              <div className="tt-popover">
                {!inTable ? (
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setOpenMenu(null); }}>Insert 3×3 table</button>
                ) : (
                  <>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}>Add column</button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}>Delete column</button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}>Add row</button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}>Delete row</button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeaderRow().run(); }}>Toggle header row</button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().mergeOrSplit().run(); }}>Merge / split cells</button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run(); setOpenMenu(null); }}>Delete table</button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <span className="tt-sep" />
      <div className="tt-menu-wrap">
        {btn(<><Icon name="add" size={13} /> Embed</>, () => setOpenMenu(openMenu === 'insert' ? null : 'insert'), false, 'Embed entry or asset')}
        {openMenu === 'insert' && (
          <div className="tt-popover">
            <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpenMenu(null); bridge?.requestEntry((id) => editor.chain().focus().insertContent({ type: 'embeddedEntryBlock', attrs: { id } }).run()); }}>Entry (block)</button>
            <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpenMenu(null); bridge?.requestEntry((id) => editor.chain().focus().insertContent({ type: 'embeddedEntryInline', attrs: { id } }).run()); }}>Entry (inline)</button>
            <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpenMenu(null); bridge?.requestAsset((id) => editor.chain().focus().insertContent({ type: 'embeddedAssetBlock', attrs: { id } }).run()); }}>Asset</button>
          </div>
        )}
      </div>

      <span className="tt-sep" />
      {btn(<Icon name="reload" size={13} />, () => editor.chain().focus().undo().run(), false, 'Undo')}
      {btn(<span style={{ transform: 'scaleX(-1)', display: 'inline-block' }}><Icon name="reload" size={13} /></span>, () => editor.chain().focus().redo().run(), false, 'Redo')}
      <span className="tt-hint muted small">Type <kbd>/</kbd> for commands</span>
    </div>
  );
}

function SwatchPopover({
  swatches,
  current,
  onPick,
  onClear,
  warnLowContrast,
}: {
  swatches: string[];
  current?: string;
  onPick: (color: string) => void;
  onClear: () => void;
  warnLowContrast?: boolean;
}) {
  const [hex, setHex] = useState(current ?? '#000000');
  const lowContrast = warnLowContrast && contrastOnWhite(hex) < 4.5;
  return (
    <div className="tt-popover swatch-popover" onMouseDown={(e) => e.preventDefault()}>
      <div className="swatch-grid">
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${current?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'} onChange={(e) => setHex(e.target.value)} />
        <input className="input mono" style={{ height: 28, fontSize: 12 }} value={hex} onChange={(e) => setHex(e.target.value)} />
        <button type="button" className="btn secondary tiny" onClick={() => onPick(hex)}>Apply</button>
      </div>
      {lowContrast && <p className="error-text small" style={{ margin: '6px 0 0' }}>Low contrast on white (WCAG AA)</p>}
      <button type="button" className="btn ghost tiny" style={{ marginTop: 6, width: '100%' }} onClick={onClear}>Remove color</button>
    </div>
  );
}
