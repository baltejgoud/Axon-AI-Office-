import type * as Ts from 'typescript';
import { createHash } from 'node:crypto';
export interface CodeSymbol { name: string; kind: string; startLine: number; endLine: number }
export interface FileSnapshot { path: string; hash: string; symbols: CodeSymbol[]; imports: string[] }
export class CodeContextCache {
  private snapshots = new Map<string, FileSnapshot>();
  async snapshot(path: string, content: string): Promise<FileSnapshot> {
    const hash = createHash('sha256').update(content).digest('hex');
    const cached = this.snapshots.get(path);
    if (cached?.hash === hash) return cached;
    const ts = await import('typescript');
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const symbols: CodeSymbol[] = [], imports: string[] = [];
    const visit = (node: Ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) {
        const name = node.name?.getText(source);
        if (name) symbols.push({ name, kind: ts.SyntaxKind[node.kind], startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const snapshot = { path, hash, symbols, imports };
    this.snapshots.set(path, snapshot);
    if (this.snapshots.size > 128) this.snapshots.delete(this.snapshots.keys().next().value!);
    return snapshot;
  }
}
