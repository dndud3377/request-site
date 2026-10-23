// claude 수정 (2026-10-23): 리치텍스트 에디터 표 크기 기능(B-77) — 엑셀·워드 붙여넣기 시 원래 열 너비·행 높이 유지,
// 행 높이 드래그, 표 크기 초기화. 열 너비 드래그·표 전체 폭은 TipTap TableKit(resizable)이 담당한다.
import { Editor, Extension } from '@tiptap/core';
import { TableRow } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';

// 클립보드 HTML 에 표가 있는지 판별 — 엑셀·워드 표 복사는 표 HTML 과 함께 표 모양 그림(image/png)도 담는다
export const TABLE_HTML_RE = /<table[\s>]/i;

// 열 경계선 드래그 핸들 폭(px) — TipTap 기본값과 같게 두어 열·행 핸들 감도를 맞춘다
export const TABLE_RESIZE_HANDLE_PX = 5;
// 행 높이 드래그 최소값(px). 글자가 차지하는 높이보다 작게는 표 특성상 줄어들지 않는다.
const ROW_MIN_HEIGHT_PX = 20;
// 1pt = 96/72 px (엑셀·워드 HTML 은 style 크기를 pt 로 준다)
const PT_TO_PX = 96 / 72;

const ROW_RESIZE_CURSOR_CLASS = 'row-resize-cursor';
const ROW_RESIZE_ACTIVE_CLASS = 'row-resize-active';

const TABLE_NODE = 'table';
const ROW_NODE = 'tableRow';
const CELL_NODES = ['tableCell', 'tableHeader'];

/** '72' · '72px' · '54pt' → px 정수. 해석할 수 없으면 null. */
const lengthToPx = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const m = /^\s*([\d.]+)\s*(px|pt)?\s*$/i.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(m[2]?.toLowerCase() === 'pt' ? n * PT_TO_PX : n);
};

/** width 속성(px) → style width(px/pt) 순으로 읽는다. */
const elementWidthPx = (el: HTMLElement): number | null =>
  lengthToPx(el.getAttribute('width')) ?? lengthToPx(el.style.width);

/** 표의 열별 너비(px). <col>(span 포함) 이 있으면 그것을, 없으면 첫 행 셀 너비를 colspan 으로 나눠 쓴다. */
const readColumnWidths = (table: HTMLTableElement): (number | null)[] => {
  const widths: (number | null)[] = [];
  const cols = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col, :scope > col'));
  if (cols.length > 0) {
    cols.forEach((col) => {
      const span = Math.max(1, parseInt(col.getAttribute('span') || '1', 10) || 1);
      const w = elementWidthPx(col);
      for (let i = 0; i < span; i += 1) widths.push(w);
    });
    return widths;
  }
  const firstRow = table.rows[0];
  if (!firstRow) return widths;
  Array.from(firstRow.cells).forEach((cell) => {
    const span = Math.max(1, cell.colSpan || 1);
    const w = elementWidthPx(cell);
    for (let i = 0; i < span; i += 1) widths.push(w ? Math.round(w / span) : null);
  });
  return widths;
};

/** 셀마다 TipTap 이 읽는 colwidth="w1,w2" 속성을 채운다(rowspan 으로 밀린 열 위치까지 계산). */
const applyColumnWidths = (table: HTMLTableElement, widths: (number | null)[]): void => {
  const occupied: boolean[][] = [];
  Array.from(table.rows).forEach((row, r) => {
    occupied[r] = occupied[r] || [];
    let c = 0;
    Array.from(row.cells).forEach((cell) => {
      while (occupied[r][c]) c += 1;
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const spanWidths = widths.slice(c, c + colSpan);
      if (spanWidths.length === colSpan && spanWidths.every((w) => w)) {
        cell.setAttribute('colwidth', spanWidths.join(','));
      }
      for (let dr = 0; dr < rowSpan; dr += 1) {
        occupied[r + dr] = occupied[r + dr] || [];
        for (let dc = 0; dc < colSpan; dc += 1) occupied[r + dr][c + dc] = true;
      }
      c += colSpan;
    });
  });
};

/**
 * 붙여넣는 HTML 의 표 크기를 에디터 표 형식으로 옮긴다(editorProps.transformPastedHTML).
 * TipTap 기본 파서는 <col> 너비를 읽긴 하지만 첫 열을 건너뛰고(span 미처리) 셀 width 는 읽지 않는다.
 * 행 높이(<tr height> / style height)는 tableRow 의 height 속성 파서가 읽는다.
 */
export const applyPastedTableSizes = (html: string): string => {
  if (!TABLE_HTML_RE.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('table').forEach((table) => applyColumnWidths(table, readColumnWidths(table)));
  return doc.body.innerHTML;
};

/** 행 높이(px)를 저장하는 tableRow — <tr style="height: Npx"> 로 직렬화한다. */
export const TableRowWithHeight = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          lengthToPx(element.style.height) ?? lengthToPx(element.getAttribute('height')),
        renderHTML: (attributes: { height?: number | null }) =>
          attributes.height ? { style: `height: ${attributes.height}px` } : {},
      },
    };
  },
});

interface RowDrag {
  rowPos: number;
  startY: number;
  startHeight: number;
  height: number;
}

interface RowResizeState {
  hoverRowPos: number | null;
  drag: RowDrag | null;
}

type RowResizeMeta = Partial<RowResizeState>;

const rowResizeKey = new PluginKey<RowResizeState>('tableRowResize');

/** 마우스가 셀 아래 경계선 근처면 그 행의 문서 위치를 돌려준다. */
const findRowEdge = (view: EditorView, event: MouseEvent): number | null => {
  const target = event.target as HTMLElement | null;
  const cell = target?.closest?.('td, th') as HTMLTableCellElement | null;
  if (!cell || !view.dom.contains(cell) || cell.rowSpan > 1) return null;
  const rect = cell.getBoundingClientRect();
  // 셀 좌우 끝(열 경계선)은 열 너비 드래그 영역이므로 양보한다
  if (event.clientX - rect.left <= TABLE_RESIZE_HANDLE_PX || rect.right - event.clientX <= TABLE_RESIZE_HANDLE_PX) return null;
  if (rect.bottom - event.clientY > TABLE_RESIZE_HANDLE_PX || event.clientY > rect.bottom) return null;
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type.name === ROW_NODE) return $pos.before(d);
  }
  return null;
};

const rowResizePlugin = (): Plugin<RowResizeState> =>
  new Plugin<RowResizeState>({
    key: rowResizeKey,
    state: {
      init: () => ({ hoverRowPos: null, drag: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(rowResizeKey) as RowResizeMeta | undefined;
        const next = meta ? { ...prev, ...meta } : prev;
        if (!tr.docChanged || next.hoverRowPos === null) return next;
        return { ...next, hoverRowPos: tr.mapping.map(next.hoverRowPos) };
      },
    },
    props: {
      // 커서 클래스는 ProseMirror 가 갱신마다 에디터 DOM 클래스를 다시 쓰므로 attributes 로 붙인다(열 드래그와 같은 방식).
      attributes(state): Record<string, string> {
        const ps = rowResizeKey.getState(state);
        return ps && (ps.drag || ps.hoverRowPos !== null) ? { class: ROW_RESIZE_CURSOR_CLASS } : {};
      },
      // 드래그 중에는 문서를 바꾸지 않고 장식(style)으로만 미리 보여주고, 놓을 때 한 번만 저장한다(실행 취소 1단계).
      decorations(state) {
        const ps = rowResizeKey.getState(state);
        if (!ps) return null;
        const pos = ps.drag ? ps.drag.rowPos : ps.hoverRowPos;
        if (pos === null) return null;
        const node = state.doc.nodeAt(pos);
        if (!node || node.type.name !== ROW_NODE) return null;
        const attrs: Record<string, string> = { class: ROW_RESIZE_ACTIVE_CLASS };
        if (ps.drag) attrs.style = `height: ${ps.drag.height}px`;
        return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, attrs)]);
      },
      handleDOMEvents: {
        mousemove(view, event) {
          const ps = rowResizeKey.getState(view.state);
          if (!view.editable || !ps || ps.drag) return false;
          const rowPos = findRowEdge(view, event);
          if (rowPos !== ps.hoverRowPos) view.dispatch(view.state.tr.setMeta(rowResizeKey, { hoverRowPos: rowPos }));
          return false;
        },
        mouseleave(view) {
          const ps = rowResizeKey.getState(view.state);
          if (!ps || ps.drag || ps.hoverRowPos === null) return false;
          view.dispatch(view.state.tr.setMeta(rowResizeKey, { hoverRowPos: null }));
          return false;
        },
        mousedown(view, event) {
          if (!view.editable || event.button !== 0) return false;
          const rowPos = findRowEdge(view, event);
          if (rowPos === null) return false;
          const rowDom = view.nodeDOM(rowPos) as HTMLElement | null;
          if (!rowDom) return false;
          event.preventDefault();
          const startHeight = Math.round(rowDom.getBoundingClientRect().height);
          view.dispatch(view.state.tr.setMeta(rowResizeKey, {
            drag: { rowPos, startY: event.clientY, startHeight, height: startHeight },
          }));
          const win = view.dom.ownerDocument.defaultView || window;
          const onMove = (e: MouseEvent) => {
            const drag = rowResizeKey.getState(view.state)?.drag;
            if (!drag) return;
            const height = Math.max(ROW_MIN_HEIGHT_PX, Math.round(drag.startHeight + e.clientY - drag.startY));
            if (height !== drag.height) view.dispatch(view.state.tr.setMeta(rowResizeKey, { drag: { ...drag, height } }));
          };
          const onUp = () => {
            win.removeEventListener('mousemove', onMove);
            win.removeEventListener('mouseup', onUp);
            const drag = rowResizeKey.getState(view.state)?.drag;
            const tr = view.state.tr.setMeta(rowResizeKey, { drag: null, hoverRowPos: null });
            const node = drag ? tr.doc.nodeAt(drag.rowPos) : null;
            if (drag && node && node.type.name === ROW_NODE && drag.height !== drag.startHeight) {
              tr.setNodeMarkup(drag.rowPos, undefined, { ...node.attrs, height: drag.height });
            }
            view.dispatch(tr);
          };
          win.addEventListener('mousemove', onMove);
          win.addEventListener('mouseup', onUp);
          return true;
        },
      },
    },
  });

/** 셀 아래 경계선을 드래그해 행 높이를 바꾼다(편집 모드에서만). */
export const TableRowResize = Extension.create({
  name: 'tableRowResize',
  addProseMirrorPlugins() {
    return this.editor.isEditable ? [rowResizePlugin()] : [];
  },
});

/** 커서가 있는 표의 열 너비·행 높이를 모두 지워 화면 폭에 맞춘다. 표 밖이면 아무것도 하지 않는다. */
export const resetTableSize = (editor: Editor): void => {
  const { state } = editor;
  const { $from } = state.selection;
  let table: PMNode | null = null;
  let tablePos = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === TABLE_NODE) {
      table = $from.node(d);
      tablePos = $from.before(d);
      break;
    }
  }
  if (!table) return;
  const tr = state.tr;
  table.descendants((node, pos) => {
    const abs = tablePos + 1 + pos;
    if (node.type.name === ROW_NODE) {
      if (node.attrs.height) tr.setNodeMarkup(abs, undefined, { ...node.attrs, height: null });
      return true;
    }
    if (CELL_NODES.includes(node.type.name)) {
      if (node.attrs.colwidth) tr.setNodeMarkup(abs, undefined, { ...node.attrs, colwidth: null });
    }
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
};
