import React, { useRef, useState } from 'react';

const CARD_W = 186;
const CARD_H = 108;
const COLS = 4;
const GAP = 16;

function defaultPos(i) {
  return { x: GAP + (i % COLS) * (CARD_W + GAP), y: GAP + Math.floor(i / COLS) * (CARD_H + GAP) };
}

// 通用画布：拖动时只更新本地坐标，pointerup 才提交一次，避免每帧写项目。
export default function CanvasBoard({ items = [], layout = {}, onCommit, renderItem, empty = '暂无可显示的内容' }) {
  const [drag, setDrag] = useState(null);
  const start = useRef(null);
  const positions = React.useMemo(() => Object.fromEntries(items.map((it, i) => [
    it.id,
    layout?.[it.id] || defaultPos(i),
  ])), [items, layout]);
  const height = Math.max(340, Math.ceil(Math.max(items.length, 1) / COLS) * (CARD_H + GAP) + GAP);

  function down(e, item) {
    if (e.button !== undefined && e.button !== 0) return;
    const p = positions[item.id];
    start.current = { id: item.id, px: e.clientX, py: e.clientY, x: p.x, y: p.y };
    setDrag({ id: item.id, x: p.x, y: p.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function move(e) {
    if (!start.current) return;
    const s = start.current;
    setDrag({
      id: s.id,
      x: Math.max(0, s.x + e.clientX - s.px),
      y: Math.max(0, s.y + e.clientY - s.py),
    });
  }

  function up() {
    if (!start.current || !drag) return;
    const { id } = start.current;
    onCommit?.(id, { x: Math.round(drag.x), y: Math.round(drag.y) });
    start.current = null;
    setDrag(null);
  }

  if (!items.length) return <div className="loc-empty">{empty}</div>;
  return (
    <div className="loc-canvas-wrap">
      <div className="loc-canvas canvas-board" style={{ height }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {items.map((item, i) => {
          const p = drag?.id === item.id ? drag : positions[item.id] || defaultPos(i);
          return (
            <div
              key={item.id}
              className={`loc-node canvas-board-node ${drag?.id === item.id ? 'dragging' : ''}`}
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              onPointerDown={e => down(e, item)}
            >
              {renderItem ? renderItem(item, i) : <div className="loc-node-title">{item.title}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
