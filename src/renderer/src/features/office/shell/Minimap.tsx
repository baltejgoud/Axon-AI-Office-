import { useRef, useState, type PointerEvent } from 'react';
import { Map as MapIcon, Minimize2 } from 'lucide-react';
import { DISTRICTS, type Bounds } from '../campus/districts';
import { HOME_DESKS, ROOM, poiById } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';

const WIDTH = ROOM.maxX - ROOM.minX;
const DEPTH = ROOM.maxZ - ROOM.minZ;
const STORAGE_KEY = 'axon.office.minimap';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/**
 * A small floor plan: every district in its colour, the part of the campus on screen, and a dot for
 * everyone working on a task. Click or drag to move the view.
 */
export function Minimap({
  view,
  working,
  selectedId,
  onLook
}: {
  view: Bounds | null;
  working: string[];
  selectedId: string;
  onLook: (point: Vec2) => void;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const setAndRemember = (value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'collapsed' : 'open');
    } catch {
      // Private mode or blocked storage: the choice just is not remembered.
    }
  };

  const toFloor = (event: PointerEvent<SVGSVGElement>): Vec2 => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: ROOM.minX + ((event.clientX - rect.left) / rect.width) * WIDTH,
      z: ROOM.minZ + ((event.clientY - rect.top) / rect.height) * DEPTH
    };
  };

  if (collapsed)
    return (
      <button
        className="office-minimap-toggle"
        aria-label="Show map"
        title="Show map"
        onClick={() => setAndRemember(false)}
      >
        <MapIcon size={16} />
      </button>
    );

  const dot = (id: string) => poiById(HOME_DESKS[id]).position;
  return (
    <div className="office-minimap">
      <svg
        ref={svg}
        viewBox={`${ROOM.minX} ${ROOM.minZ} ${WIDTH} ${DEPTH}`}
        role="img"
        aria-label="Campus map. Click to move the view."
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onLook(toFloor(event));
        }}
        onPointerMove={(event) => {
          if (dragging.current) onLook(toFloor(event));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        <rect
          x={ROOM.minX}
          y={ROOM.minZ}
          width={WIDTH}
          height={DEPTH}
          className="office-minimap-floor"
          rx={2}
        />
        {DISTRICTS.map((district) => {
          const { minX, maxX, minZ, maxZ } = district.bounds;
          return (
            <rect
              key={district.id}
              x={minX}
              y={minZ}
              width={maxX - minX}
              height={maxZ - minZ}
              rx={1.2}
              fill={district.color}
              fillOpacity={0.2}
              stroke={district.color}
              strokeOpacity={0.55}
              strokeWidth={0.6}
            >
              <title>{district.name}</title>
            </rect>
          );
        })}
        {working.map((id) => {
          const p = dot(id);
          return <circle key={id} cx={p.x} cy={p.z} r={1.1} className="office-minimap-working" />;
        })}
        {HOME_DESKS[selectedId] && (
          <circle cx={dot(selectedId).x} cy={dot(selectedId).z} r={1.5} className="office-minimap-selected" />
        )}
        {view && (
          <rect
            x={view.minX}
            y={view.minZ}
            width={view.maxX - view.minX}
            height={view.maxZ - view.minZ}
            className="office-minimap-view"
            rx={1}
          />
        )}
      </svg>
      <button
        className="office-minimap-hide"
        aria-label="Hide map"
        title="Hide map"
        onClick={() => setAndRemember(true)}
      >
        <Minimize2 size={13} />
      </button>
    </div>
  );
}
