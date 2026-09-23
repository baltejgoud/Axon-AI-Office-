// The campus: districts, generated layout, navigation at scale, rendering tiers and search.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const districts = require('../src/renderer/src/features/office/campus/districts.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');
const catalog = require('../src/renderer/src/features/office/data/coworkerCatalog.ts');

test('every catalog department belongs to exactly one district', () => {
  const listed = districts.DISTRICTS.flatMap((d) => d.departments);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual([...listed].sort(), [...catalog.SPECIALIST_GROUPS].sort());
  assert.equal(catalog.SPECIALIST_GROUPS.length, 22);
});

test('all 207 coworkers have a district and department', () => {
  assert.equal(agents.OFFICE_AGENTS.length, 207);
  for (const a of agents.OFFICE_AGENTS) {
    assert.ok(districts.districtById(a.district), a.id);
    assert.ok(a.department, a.id);
  }
  assert.equal(agents.OFFICE_AGENTS.filter((a) => a.district === 'commons').length, 8);
});

test('district colours are dark enough for white text and for text on white', () => {
  const lum = (hex) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const d of districts.DISTRICTS) assert.ok(1.05 / (lum(d.color) + 0.05) >= 4.5, `${d.id} ${d.color}`);
});

test('district rectangles do not overlap and keep a 2.4 m corridor', () => {
  const list = districts.DISTRICTS;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].bounds;
      const b = list[j].bounds;
      const gapX = Math.max(b.minX - a.maxX, a.minX - b.maxX);
      const gapZ = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
      assert.ok(Math.max(gapX, gapZ) >= 2.4, `${list[i].id} / ${list[j].id}`);
    }
});
