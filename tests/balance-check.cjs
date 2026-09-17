const fs = require('node:fs');
for (const file of ['src/main/infra/paths.ts', 'src/main/knowledge.ts']) {
  const s = fs.readFileSync(file, 'utf8');
  const count = (ch) => s.split(ch).length - 1;
  console.log(file, 'braces:', count('{') - count('}'), 'parens:', count('(') - count(')'), 'brackets:', count('[') - count(']'));
}
