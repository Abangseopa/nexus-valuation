import { useState, useCallback, useRef, useEffect } from "react";
import type { Sheet, Cell } from "@/lib/spreadsheet-utils";

interface SpreadsheetGridProps {
  sheets: Sheet[];
  activeSheetIndex?: number;
  onSheetChange?: (index: number) => void;
}

const ROW_NUM_WIDTH = 36;
const ROW_HEIGHT = 21;
const HEADER_HEIGHT = 21;

function colLetter(i: number): string {
  let r = "";
  let n = i;
  do {
    r = String.fromCharCode(65 + (n % 26)) + r;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return r;
}

function cellBg(bg?: Cell["bg"]): string {
  switch (bg) {
    case "header":    return "bg-[#1e3a5f] text-white";
    case "subheader": return "bg-[#dbeafe] text-gray-800";
    case "input":     return "bg-[#fffde7] text-gray-900";
    case "total":     return "bg-[#f3f4f6] text-gray-900";
    case "divider":   return "bg-[#e5e7eb] text-gray-700";
    case "highlight": return "bg-[#dcfce7] text-gray-900";
    default:          return "bg-white text-gray-800";
  }
}

function cellText(cell: Cell): string {
  const cls: string[] = [];
  if (cell.bold)  cls.push("font-semibold");
  if (cell.italic) cls.push("italic");
  if (cell.color === "muted")    cls.push("text-gray-400");
  if (cell.color === "negative") cls.push("text-red-600");
  if (cell.color === "positive") cls.push("text-emerald-700");
  return cls.join(" ");
}

export function SpreadsheetGrid({
  sheets,
  activeSheetIndex = 0,
  onSheetChange,
}: SpreadsheetGridProps) {
  const [activeIdx, setActiveIdx] = useState(activeSheetIndex);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [editing,  setEditing]  = useState(false);
  const [editVal,  setEditVal]  = useState("");
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveIdx(activeSheetIndex);
    setSelected(null);
    setEditing(false);
  }, [activeSheetIndex, sheets]);

  const sheet = sheets[activeIdx] ?? sheets[0];
  if (!sheet) return null;

  const { rows, colWidths } = sheet;
  const numCols = Math.max(...rows.map(r => r.length), colWidths.length, 1);

  const key = (r: number, c: number) => `${activeIdx}:${r}:${c}`;

  const getDisplayValue = (r: number, c: number): string => {
    const k = key(r, c);
    if (overrides.has(k)) return overrides.get(k)!;
    const cell = rows[r]?.[c];
    return cell?.value != null ? String(cell.value) : "";
  };

  const getCell = (r: number, c: number): Cell =>
    rows[r]?.[c] ?? { value: null };

  const commitEdit = useCallback(() => {
    if (!selected) return;
    const k = key(selected.row, selected.col);
    setOverrides(prev => new Map(prev).set(k, editVal));
    setEditing(false);
  }, [selected, editVal, key]);

  const startEdit = useCallback((r: number, c: number, initial?: string) => {
    setEditing(true);
    // If the cell has a formula (and user didn't type a replacement char), edit the formula
    const cell = getCell(r, c);
    const startValue = initial ?? (overrides.has(key(r, c)) ? overrides.get(key(r, c))! : (cell.formula ?? getDisplayValue(r, c)));
    setEditVal(startValue);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, [getDisplayValue, getCell, overrides, key]);

  const moveTo = useCallback((r: number, c: number) => {
    const maxR = rows.length - 1;
    const maxC = numCols - 1;
    setSelected({ row: Math.max(0, Math.min(maxR, r)), col: Math.max(0, Math.min(maxC, c)) });
  }, [rows.length, numCols]);

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) {
      if (e.key !== "Tab") setSelected({ row: 0, col: 0 });
      return;
    }
    const { row, col } = selected;

    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); moveTo(row + 1, col); }
      else if (e.key === "Tab") { e.preventDefault(); commitEdit(); moveTo(row, col + 1); }
      else if (e.key === "Escape") { setEditing(false); }
      return;
    }

    const moves: Record<string, () => void> = {
      ArrowUp:    () => moveTo(row - 1, col),
      ArrowDown:  () => moveTo(row + 1, col),
      ArrowLeft:  () => moveTo(row, col - 1),
      ArrowRight: () => moveTo(row, col + 1),
    };

    if (moves[e.key]) { e.preventDefault(); moves[e.key](); return; }
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(row, col); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      setOverrides(prev => new Map(prev).set(key(row, col), ""));
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      startEdit(row, col, e.key);
    }
  };

  const selRef = selected ? `${colLetter(selected.col)}${selected.row + 1}` : "";
  // Formula bar shows: formula string if cell has one, otherwise the raw value
  const selVal = selected
    ? (() => {
        const k = key(selected.row, selected.col);
        if (overrides.has(k)) return overrides.get(k)!;
        const cell = getCell(selected.row, selected.col);
        return cell.formula ?? getDisplayValue(selected.row, selected.col);
      })()
    : "";

  const switchSheet = (i: number) => {
    setActiveIdx(i);
    setSelected(null);
    setEditing(false);
    onSheetChange?.(i);
  };

  return (
    <div className="flex flex-col h-full bg-white text-[11px] font-mono outline-none" tabIndex={0} onKeyDown={handleContainerKeyDown} ref={containerRef}>

      {/* ── Formula bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-gray-300 bg-[#f8f9fa] shrink-0" style={{ height: 28 }}>
        <div className="w-[52px] shrink-0 text-center border-r border-gray-300 py-0.5 text-[11px] text-gray-700">
          {selRef || "A1"}
        </div>
        <div className="w-7 shrink-0 text-center text-gray-400 text-sm border-r border-gray-300 py-0.5 select-none">
          ƒ<span className="text-[9px] align-super">x</span>
        </div>
        <div className="flex-1 px-2 py-0.5 text-gray-700 truncate text-[11px]">
          {editing && selected
            ? <input
                ref={editInputRef}
                className="w-full outline-none bg-transparent font-mono text-[11px]"
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onBlur={commitEdit}
              />
            : selVal
          }
        </div>
      </div>

      {/* ── Scrollable grid ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto relative">
        <table className="border-collapse" style={{ tableLayout: "fixed", minWidth: ROW_NUM_WIDTH + colWidths.reduce((a, b) => a + b, 0) }}>
          <colgroup>
            <col style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH }} />
            {colWidths.map((w, i) => <col key={i} style={{ width: w, minWidth: w }} />)}
          </colgroup>

          {/* Column headers */}
          <thead className="sticky top-0 z-10">
            <tr style={{ height: HEADER_HEIGHT }}>
              <th
                className="border border-gray-300 bg-[#f0f0f0] sticky left-0 z-20"
                style={{ width: ROW_NUM_WIDTH }}
              />
              {Array.from({ length: numCols }, (_, ci) => (
                <th
                  key={ci}
                  className="border border-gray-300 bg-[#f0f0f0] text-gray-500 text-center font-normal text-[10px]"
                >
                  {colLetter(ci)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ height: ROW_HEIGHT }}>
                {/* Row number */}
                <td
                  className="border border-gray-200 bg-[#f0f0f0] text-gray-400 text-center text-[10px] font-normal sticky left-0 z-5 select-none"
                  style={{ width: ROW_NUM_WIDTH }}
                >
                  {ri + 1}
                </td>

                {/* Data cells */}
                {Array.from({ length: numCols }, (_, ci) => {
                  const cell = row?.[ci] ?? { value: null };
                  const isSel = selected?.row === ri && selected?.col === ci;
                  const isEdit = isSel && editing;
                  const dv = overrides.has(key(ri, ci))
                    ? overrides.get(key(ri, ci))!
                    : (cell.value != null ? String(cell.value) : "");

                  return (
                    <td
                      key={ci}
                      className={`
                        border-[0.5px] border-gray-200 px-1 overflow-hidden whitespace-nowrap cursor-cell
                        ${cellBg(cell.bg)}
                        ${cellText(cell)}
                      `}
                      style={{
                        textAlign: cell.align ?? "left",
                        height: ROW_HEIGHT,
                        outline: isSel ? "2px solid #3b82f6" : "none",
                        outlineOffset: "-2px",
                        position: "relative",
                      }}
                      onClick={() => {
                        if (editing) commitEdit();
                        setSelected({ row: ri, col: ci });
                        setEditing(false);
                        containerRef.current?.focus();
                      }}
                      onDoubleClick={() => {
                        setSelected({ row: ri, col: ci });
                        startEdit(ri, ci);
                      }}
                    >
                      {isEdit ? (
                        <input
                          ref={editInputRef}
                          className="absolute inset-0 w-full h-full px-1 bg-white text-gray-900 font-mono text-[11px] outline-none"
                          style={{ textAlign: cell.align ?? "left" }}
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onBlur={commitEdit}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span className="block truncate" style={{ lineHeight: `${ROW_HEIGHT}px` }}>{dv}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Sheet tabs ────────────────────────────────────────────────────────── */}
      <div className="flex items-center border-t border-gray-300 bg-[#f0f0f0] shrink-0 select-none" style={{ height: 26 }}>
        <div className="px-2 text-gray-400 text-[10px]">▶</div>
        {sheets.map((s, i) => (
          <button
            key={i}
            className={`px-3 h-full text-[11px] border-r border-gray-300 transition-colors ${
              activeIdx === i
                ? "bg-white text-blue-600 font-medium border-t-2 border-t-blue-500"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            onClick={() => switchSheet(i)}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
