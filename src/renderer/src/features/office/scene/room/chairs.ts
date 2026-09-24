import * as THREE from 'three';
import { GEOMETRY, box, mat, part } from './materials';
import { LOW, bevelBox, blend, group, noShadow, tones } from './kit';

/**
 * The ergonomic desk chair: a cushioned seat, a mesh back in the district's colour, armrests and
 * a five-star base on casters. Kept lean on triangles (there are 244 of them): only the seat and the
 * back throw shadows. Centred at floor level, the sitter facing +z.
 */

const FRAME = '#2f343b';
const CUSHION = '#3b4048';
const FABRIC = { roughness: 0.9 } as const;
const STEEL = { metalness: 0.45, roughness: 0.4 } as const;

export function ergonomicChair(accent: string): THREE.Group {
  const mesh = tones(accent);
  const back = group(
    box(blend(accent, '#ffffff', 0.12), [0.4, 0.46, 0.012], [0, 0.3, 0], { roughness: 0.95 }),
    box(FRAME, [0.03, 0.5, 0.03], [-0.215, 0.3, 0]),
    box(FRAME, [0.03, 0.5, 0.03], [0.215, 0.3, 0]),
    box(FRAME, [0.46, 0.03, 0.03], [0, 0.55, 0]),
    box(FRAME, [0.44, 0.03, 0.03], [0, 0.06, 0])
  );
  back.add(noShadow(group(box(mesh.dark, [0.38, 0.06, 0.02], [0, 0.17, 0.012], FABRIC))));
  back.position.set(0, 0.47, -0.235);
  back.rotation.x = -0.12;

  const details = group(
    // The spine joining seat and back.
    box(FRAME, [0.06, 0.18, 0.03], [0, 0.44, -0.245]),
    // Armrests: posts and pads.
    box(FRAME, [0.03, 0.2, 0.04], [-0.255, 0.56, -0.02]),
    box(FRAME, [0.03, 0.2, 0.04], [0.255, 0.56, -0.02]),
    box(CUSHION, [0.06, 0.025, 0.22], [-0.255, 0.67, 0], FABRIC),
    box(CUSHION, [0.06, 0.025, 0.22], [0.255, 0.67, 0], FABRIC),
    // Gas lift in its sleeve, on the hub of the base.
    part(LOW.can, mat('#9aa1ab', STEEL), [0.045, 0.16, 0.045], [0, 0.34, 0]),
    part(LOW.can, mat(FRAME), [0.075, 0.2, 0.075], [0, 0.17, 0])
  );
  // A five-star base, each spoke ending in a caster.
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + Math.PI / 5;
    const [s, c] = [Math.sin(angle), Math.cos(angle)];
    details.add(
      part(GEOMETRY.box, mat(FRAME), [0.035, 0.03, 0.26], [s * 0.13, 0.075, c * 0.13], [0, angle, 0]),
      part(
        GEOMETRY.box,
        mat('#1f2328', FABRIC),
        [0.04, 0.045, 0.05],
        [s * 0.255, 0.024, c * 0.255],
        [0, angle, 0]
      )
    );
  }
  return group(
    bevelBox(CUSHION, [0.48, 0.07, 0.46], [0, 0.465, 0.01], 0.025, FABRIC, 1),
    back,
    noShadow(details)
  );
}
