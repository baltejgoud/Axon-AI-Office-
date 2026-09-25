# Source assets

Originals of the office's 3D models. Nothing here is served or packaged: `npm run models:optimize`
(`scripts/models-optimize.mjs`) cleans each model the office uses with glTF Transform (dedup, prune,
weld) and writes the copy the app loads to `src/renderer/public/models/office/`. The office loads them
in `src/renderer/src/features/office/scene/room/models.ts`, fits each to its piece of furniture and
paints it in the office's colours; a piece whose model does not load stays code-built.

```
source_assets/
  originals/<vendor>/   files exactly as downloaded
  licenses/             one note per vendor: licence, where each file came from, when
```

- Record every download in `licenses/<vendor>.md` with its source, licence and size.
- Keep one visual family (everything so far is Quaternius).
- `npm run models:inspect -- <file.glb>` prints a model's size, triangles and materials; material
  names are what `models.ts` paints by.
