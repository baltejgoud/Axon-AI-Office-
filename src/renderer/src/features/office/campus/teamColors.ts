import { DISTRICTS, districtById, type DistrictId } from './districts';

/**
 * Colours for teams side by side in one district, so neighbouring departments read apart on the
 * floor. Like the district colours, each is dark enough for white text and for text on white (AA).
 */
const TEAM_PALETTE = [
  '#0f766e',
  '#7c3aed',
  '#b45309',
  '#be185d',
  '#15803d',
  '#c2410c',
  '#0e7490',
  '#9f1239',
  '#4338ca',
  '#a16207'
];

/** Each department's colour: the district's own for its first, then the palette, never repeating within a district. */
const TEAM_COLORS = new Map(
  DISTRICTS.flatMap((district) => {
    const palette = [
      district.color,
      ...TEAM_PALETTE.filter((color) => color.toLowerCase() !== district.color.toLowerCase())
    ];
    return district.departments.map((department, i) => [department, palette[i % palette.length]] as const);
  })
);

/**
 * A team's colour, worn by everyone in it: their floor ring, name tag, badge and portrait. The
 * department's label on the map has it too, so the labels say which colour is which team.
 */
export function teamColor(department: string, district: DistrictId): string {
  return TEAM_COLORS.get(department) ?? districtById(district).color;
}
