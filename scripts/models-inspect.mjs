// One line per GLB: bytes, size (x, y, z metres), triangles, meshes and materials with base colours.
//   node scripts/models-inspect.mjs <file.glb> [more.glb ...]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(Math.pow(v, 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');

for (const file of process.argv.slice(2)) {
  const document = await io.read(file);
  const root = document.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      triangles += (indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount()) / 3;
    }
  const bounds = getBounds(root.listScenes()[0]);
  const size = bounds.max.map((max, i) => +(max - bounds.min[i]).toFixed(2));
  const materials = root
    .listMaterials()
    .map((m) => `${m.getName()}${hex(m.getBaseColorFactor())}${m.getBaseColorTexture() ? '+tex' : ''}`);
  console.log(
    `${path.basename(file).padEnd(26)} ${String(fs.statSync(file).size).padStart(8)}B  size ${size.join('x').padEnd(16)} min-y ${bounds.min[1].toFixed(2).padStart(5)}  ${String(triangles).padStart(6)} tris  ${root.listMeshes().length} meshes  ${root.listAnimations().length} clips  ${materials.join(' ')}`
  );
}
