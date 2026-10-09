import * as THREE from 'three';
import type { TaskItem, TaskStatus } from '../../../../../../shared/types';
import { MEETING_COLOR, type TaskBoard } from '../../campus/boards';
import type { MeetingRoomId } from '../../campus/commons';
import { roomName } from '../../../../../../shared/rooms';
import { OFFICE_AGENTS } from '../../data/officeAgents';
import { shortName } from '../../shell/framing';
import type { FurnitureItem } from '../../simulation/layout';
import { boardCards, todayLines, type Team, type TodayLine } from '../../tasks';
import { dayKey, shortDate } from '../../../../../../shared/planner';
import { UI_FONT, uiFontReady } from '../../../../fonts';

/**
 * Every task board's face, drawn into one atlas and shown by one mesh (a single draw call). A team's
 * face is its name on its colour and up to four cards, each tinted by status, with a short title
 * and who is on it. The Today board behind the front desk lists the next dated to-dos instead.
 * Only boards whose content changed are redrawn.
 */

/** The face sits over the board's writing surface. */
const FACE_HEIGHT = 1.02;
const FACE_Y = 1.41;
const FACE_OUT = 0.045;
const SLOT_HEIGHT = 176;
const ATLAS_WIDTH = 2048;
const FONT = UI_FONT;
const STATUS: Record<TaskStatus, { color: string; label: string }> = {
  working: { color: '#3867f6', label: 'Working' },
  attention: { color: '#d97706', label: 'Needs attention' },
  done: { color: '#1c9e72', label: 'Done' },
  open: { color: '#67758e', label: 'To do' }
};

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placed {
  board: TaskBoard;
  item: FurnitureItem;
  slot: Slot;
  cards: TaskItem[];
  /** The team in the board's meeting room, which it shows while they are there. */
  roomCards: TaskItem[];
  /** The Today board's lines, and the day they were drawn for. */
  lines: TodayLine[];
  day: Date;
  signature: string;
}

const PEOPLE = new Map(OFFICE_AGENTS.map((agent) => [agent.id, agent]));

/** A meeting room's board shows the team in it; when the room is free, its own cards (if any). */
const shown = (place: Placed): TaskItem[] => (place.roomCards.length ? place.roomCards : place.cards);
const cardsSignature = (place: Placed) =>
  `${place.roomCards.length > 0}|${shown(place)
    .map((card) => `${card.id}:${card.status}:${card.title}`)
    .join('|')}`;

/** A point on a board's face, `across` metres to its right and `up` from the floor, in the world. */
function facePoint(item: FurnitureItem, across: number, up: number): THREE.Vector3 {
  const [sin, cos] = [Math.sin(item.rotation), Math.cos(item.rotation)];
  return new THREE.Vector3(item.x + across * cos + FACE_OUT * sin, up, item.z - across * sin + FACE_OUT * cos);
}

function initials(name: string): string {
  return name
    .replace(/\(.*\)/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/** Cuts text to fit, with an ellipsis. */
function fitted(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export class BoardLayer {
  readonly object: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly placed: Placed[] = [];

  constructor(boards: readonly TaskBoard[], furniture: readonly FurnitureItem[]) {
    const items = new Map(furniture.map((item) => [item.id, item]));
    let x = 0;
    let y = 0;
    for (const board of boards) {
      const item = items.get(board.itemId);
      if (!item) continue;
      const w = Math.round((SLOT_HEIGHT * (item.w - 0.1)) / FACE_HEIGHT);
      if (x + w > ATLAS_WIDTH) {
        x = 0;
        y += SLOT_HEIGHT;
      }
      this.placed.push({
        board,
        item,
        slot: { x, y, w, h: SLOT_HEIGHT },
        cards: [],
        roomCards: [],
        lines: [],
        day: new Date(),
        signature: ''
      });
      x += w;
    }
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = Math.ceil((y + SLOT_HEIGHT) / 64) * 64;
    for (const place of this.placed) this.draw(place);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.object = new THREE.Mesh(
      this.geometry(),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })
    );
    this.object.name = 'task-boards';
    // Redraw once the UI font has loaded, so the cards match the rest of the app.
    void uiFontReady().then(() => {
      for (const place of this.placed) this.draw(place);
      this.texture.needsUpdate = true;
    });
  }

  /**
   * Shows the latest cards; boards whose cards did not change are left alone. Called again each
   * minute, so the Today board's 'Today' and 'Tomorrow' move on with the clock.
   */
  setTasks(tasks: readonly TaskItem[], now = new Date()): void {
    let changed = false;
    for (const place of this.placed) {
      let signature: string;
      // A meeting room's board follows the teams instead (setRooms).
      if (place.board.kind === 'meeting') continue;
      if (place.board.kind === 'today') {
        place.lines = todayLines(tasks, now);
        place.day = now;
        signature = [
          dayKey(now),
          ...place.lines.map((line) => `${line.label}:${line.overdue}:${line.title}`)
        ].join('|');
      } else {
        place.cards = boardCards(tasks, place.board.team);
        signature = cardsSignature(place);
      }
      if (signature === place.signature) continue;
      place.signature = signature;
      this.draw(place);
      changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  /** Each meeting room's open team on that room's board: its goal while it meets, then its tasks. */
  setRooms(cards: Readonly<Partial<Record<MeetingRoomId, readonly TaskItem[]>>>): void {
    let changed = false;
    for (const place of this.placed) {
      if (!place.board.room) continue;
      place.roomCards = [...(cards[place.board.room] ?? [])];
      const signature = cardsSignature(place);
      if (signature === place.signature) continue;
      place.signature = signature;
      this.draw(place);
      changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  /** The team whose board is under the pointer. */
  pick(raycaster: THREE.Raycaster): Team | null {
    return this.pickHit(raycaster)?.team ?? null;
  }

  /** The board under the pointer and how far along the ray it is, to weigh against a sign. */
  pickHit(raycaster: THREE.Raycaster): { distance: number; team: Team } | null {
    const hit = raycaster.intersectObject(this.object, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const team = this.placed[Math.floor(hit.faceIndex / 2)]?.board.team;
    return team ? { distance: hit.distance, team } : null;
  }

  /** Where a team's board appears on screen, in canvas pixels (for automated checks). */
  screenPoint(
    team: Team,
    camera: THREE.Camera,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    const place = this.placed.find((p) => p.board.team === team);
    if (!place) return null;
    const p = facePoint(place.item, 0, FACE_Y).project(camera);
    return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
  }

  /** What each board shows, for the debug handle. The Today board's lines read "10:00 — Title". */
  info(): { team: Team; cards: { title: string; status: TaskStatus }[]; title: string }[] {
    return this.placed.map((place) => ({
      team: place.board.team,
      cards:
        place.board.kind === 'today'
          ? place.lines.map((line) => ({
              title: `${line.label} — ${line.title}`,
              status: line.overdue ? ('attention' as const) : ('open' as const)
            }))
          : shown(place).map((card) => ({ title: this.cardTitle(card), status: card.status })),
      title: this.titleOf(place)
    }));
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  private cardTitle(card: TaskItem): string {
    if (card.kind !== 'help') return card.title;
    return `Helping ${shortName(PEOPLE.get(card.forCoworkerId ?? '')?.name ?? 'a colleague')}`;
  }

  /** The header: the room's name while a team is in it, else the board's own (the Today board adds the date). */
  private titleOf(place: Placed): string {
    const { board } = place;
    if (board.kind === 'today') return `${board.title} · ${shortDate(dayKey(place.day), place.day)}`;
    return place.roomCards.length && board.room ? roomName(board.room) : board.title;
  }

  private geometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.placed.forEach(({ item, slot }, i) => {
      const half = (item.w - 0.1) / 2;
      const bottom = FACE_Y - FACE_HEIGHT / 2;
      const top = FACE_Y + FACE_HEIGHT / 2;
      // Left-bottom, right-bottom, right-top, left-top, as seen from in front of the board.
      for (const [across, up] of [
        [-half, bottom],
        [half, bottom],
        [half, top],
        [-half, top]
      ])
        positions.push(...facePoint(item, across, up).toArray());
      const u0 = (slot.x + 1) / W;
      const u1 = (slot.x + slot.w - 1) / W;
      const v0 = 1 - (slot.y + slot.h - 1) / H;
      const v1 = 1 - (slot.y + 1) / H;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private draw(place: Placed): void {
    const { board, slot } = place;
    const cards = shown(place);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { x, y, w, h } = slot;
    ctx.clearRect(x, y, w, h);
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(x, y, w, h);
    // Header: the team's or room's name on its colour.
    const header = 34;
    ctx.fillStyle = place.roomCards.length ? MEETING_COLOR : board.color;
    ctx.fillRect(x, y, w, header);
    ctx.fillStyle = '#ffffff';
    ctx.font = `650 19px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(fitted(ctx, this.titleOf(place), w - 20), x + 10, y + header / 2 + 1);
    if (board.kind === 'today') return this.drawToday(ctx, place, header);
    // Four tiles, two by two.
    const pad = 6;
    const tileW = (w - pad * 3) / 2;
    const tileH = (h - header - pad * 3) / 2;
    for (let i = 0; i < 4; i++) {
      const tx = x + pad + (i % 2) * (tileW + pad);
      const ty = y + header + pad + Math.floor(i / 2) * (tileH + pad);
      const card = cards[i];
      ctx.beginPath();
      ctx.roundRect(tx, ty, tileW, tileH, 6);
      if (!card) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#d5dbe5';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const status = STATUS[card.status];
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = `${status.color}1f`;
      ctx.fillRect(tx, ty, tileW, tileH);
      ctx.fillStyle = status.color;
      ctx.fillRect(tx, ty, 6, tileH);
      ctx.restore();
      ctx.fillStyle = '#16233b';
      ctx.font = `650 16px ${FONT}`;
      ctx.fillText(fitted(ctx, this.cardTitle(card), tileW - 20), tx + 13, ty + 18);
      const person = PEOPLE.get(card.coworkerId ?? '');
      const dotX = tx + 22;
      const dotY = ty + tileH - 17;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 10, 0, Math.PI * 2);
      ctx.fillStyle = person?.accentColor ?? '#67758e';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(initials(person?.name ?? '?'), dotX, dotY + 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = status.color;
      ctx.font = `600 12px ${FONT}`;
      const line = `${shortName(person?.name ?? '')} · ${status.label}`;
      ctx.fillText(fitted(ctx, line, tileW - 44), dotX + 16, dotY + 1);
    }
  }

  /** The day's list: when on the left in the board's colour (amber when overdue), then what. */
  private drawToday(ctx: CanvasRenderingContext2D, { board, slot, lines }: Placed, header: number): void {
    const { x, y, w, h } = slot;
    const top = y + header + 4;
    const rowH = (h - header - 8) / 5;
    if (!lines.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#67758e';
      ctx.font = `600 17px ${FONT}`;
      ctx.fillText('Nothing scheduled', x + w / 2, top + rowH * 2);
      ctx.font = `500 13px ${FONT}`;
      ctx.fillText('Ask the receptionist to plan your day', x + w / 2, top + rowH * 3);
      ctx.textAlign = 'left';
      return;
    }
    const labelW = 96;
    lines.forEach((line, i) => {
      const cy = top + rowH * i + rowH / 2;
      if (i > 0) {
        ctx.fillStyle = '#ece8e1';
        ctx.fillRect(x + 10, top + rowH * i, w - 20, 1);
      }
      ctx.fillStyle = line.overdue ? '#d97706' : board.color;
      ctx.font = `700 14px ${FONT}`;
      ctx.fillText(fitted(ctx, line.label, labelW - 8), x + 12, cy + 1);
      ctx.fillStyle = '#16233b';
      ctx.font = `600 15px ${FONT}`;
      ctx.fillText(fitted(ctx, line.title, w - labelW - 22), x + 12 + labelW, cy + 1);
    });
  }
}
