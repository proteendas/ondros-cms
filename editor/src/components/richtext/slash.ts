/**
 * "/" slash command menu (spec 015) built on @tiptap/suggestion. Typing "/"
 * opens a filterable command list; Enter/click runs the selected command.
 *
 * The popup is a plain DOM element (no tippy/React portal dependency) so the
 * extension stays self-contained. Commands are filtered by the field's
 * restrictions via the `items` factory passed from RichTextField.
 */
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

export interface SlashCommand {
  title: string;
  hint: string;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
}

export interface SlashOptions {
  commands: (query: string) => SlashCommand[];
}

function renderPopup() {
  let el: HTMLDivElement | null = null;
  let items: SlashCommand[] = [];
  let selected = 0;
  let cmd: { editor: Editor; range: Range } | null = null;

  const paint = () => {
    if (!el) return;
    el.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'slash-empty';
      empty.textContent = 'No matches';
      el.appendChild(empty);
      return;
    }
    items.forEach((item, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `slash-item${i === selected ? ' active' : ''}`;
      row.innerHTML = `<span class="slash-title">${item.title}</span><span class="slash-hint">${item.hint}</span>`;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      el!.appendChild(row);
    });
  };

  const choose = (i: number) => {
    const item = items[i];
    if (item && cmd) item.run(cmd.editor, cmd.range);
  };

  const position = (props: { clientRect?: (() => DOMRect | null) | null }) => {
    if (!el || !props.clientRect) return;
    const rect = props.clientRect();
    if (!rect) return;
    el.style.top = `${rect.bottom + window.scrollY + 4}px`;
    el.style.left = `${rect.left + window.scrollX}px`;
  };

  return {
    onStart: (props: any) => {
      items = props.items;
      selected = 0;
      cmd = { editor: props.editor, range: props.range };
      el = document.createElement('div');
      el.className = 'slash-menu';
      document.body.appendChild(el);
      paint();
      position(props);
    },
    onUpdate: (props: any) => {
      items = props.items;
      cmd = { editor: props.editor, range: props.range };
      if (selected >= items.length) selected = 0;
      paint();
      position(props);
    },
    onKeyDown: (props: any) => {
      const { key } = props.event;
      if (key === 'ArrowDown') {
        selected = (selected + 1) % Math.max(items.length, 1);
        paint();
        return true;
      }
      if (key === 'ArrowUp') {
        selected = (selected - 1 + items.length) % Math.max(items.length, 1);
        paint();
        return true;
      }
      if (key === 'Enter') {
        choose(selected);
        return true;
      }
      if (key === 'Escape') {
        return true;
      }
      return false;
    },
    onExit: () => {
      el?.remove();
      el = null;
      cmd = null;
    },
  };
}

export const SlashCommands = Extension.create<SlashOptions>({
  name: 'slashCommands',
  addOptions() {
    return { commands: () => [] };
  },
  addProseMirrorPlugins() {
    const options: Omit<SuggestionOptions, 'editor'> = {
      char: '/',
      startOfLine: false,
      allowSpaces: true,
      command: ({ editor, range, props }) => {
        (props as SlashCommand).run(editor, range);
      },
      items: ({ query }) => this.options.commands(query),
      render: renderPopup,
    };
    return [Suggestion({ editor: this.editor, ...options })];
  },
});
