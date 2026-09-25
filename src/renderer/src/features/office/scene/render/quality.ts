/** Auto follows the machine; High draws sharper, with finer shadows; Balanced draws at screen resolution. */
export type QualityMode = 'auto' | 'high' | 'balanced';
export type QualityLevel = 'high' | 'balanced';

const STORAGE_KEY = 'axon.office.quality';
const SLOW_FPS = 45;
const SLOW_SECONDS = 4;

/** The chosen quality (a per-device preference; Auto unless changed in Settings). */
export function qualityPreference(): QualityMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'high' || stored === 'balanced' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function setQualityPreference(mode: QualityMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new Event('axon-office-quality'));
  } catch {
    // Storage is unavailable: the choice lasts until the office reloads.
  }
}

/**
 * Auto quality: starts High and steps down to Balanced once the frame rate stays under 45 fps
 * for 4 s while the view is steady. It never steps back up in the same session.
 */
export class AutoQuality {
  level: QualityLevel = 'high';
  private slow = 0;

  sample(fps: number, dt: number, steady: boolean): QualityLevel {
    if (this.level === 'balanced') return this.level;
    this.slow = steady && fps < SLOW_FPS ? this.slow + dt : 0;
    if (this.slow >= SLOW_SECONDS) this.level = 'balanced';
    return this.level;
  }
}
