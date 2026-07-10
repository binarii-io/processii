import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard: the `/core` subpath is **importable from a pure Node runtime where React is not even
 * resolvable**. We prove it by statically walking the WHOLE relative-import closure of `core.ts`
 * (the exact set of modules a `import … from '@binarii/processii/core'` pulls in) and asserting NO
 * reachable module imports React or any React-coupled UI dependency.
 *
 * Source-graph (not `dist/`) so the check never depends on build ordering — the compiled
 * `dist/core.js` closure carries the identical import graph (tsc emits imports 1:1), and we also
 * assert `dist/core.js` when a build is present. A regression (someone adds a React import to a core
 * module, or points `core.ts` at a `.tsx`) fails here immediately.
 */

const HERE = dirname(fileURLToPath(import.meta.url)); // .../packages/processii/src

/** Anything that (transitively) drags in React / the DOM UI kit — forbidden in the core closure. */
const REACT_COUPLED = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@radix-ui',
  'lucide-react',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
];

/** Extract the specifiers of real `import … from '…'` / `export … from '…'` statements (not strings/comments). */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // Match only statements that START with import/export (multiline-aware), avoiding string literals
  // like `source: '@binarii/processii'` that merely contain `from '…'`.
  const re = /^\s*(?:import|export)\b[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) specs.push(m[1]);
  return specs;
}

/** Resolve a relative `.js` specifier (tsc/ESM style) to its `.ts` source file, or `null` if absent. */
function resolveTs(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Walk the transitive relative-import closure of `entry`, returning { files, bareImports }. */
function closure(entry: string): { files: Set<string>; bare: Map<string, string> } {
  const files = new Set<string>();
  const bare = new Map<string, string>(); // bare specifier -> the file that imports it
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      const local = resolveTs(file, spec);
      if (local) stack.push(local);
      else if (!spec.startsWith('.')) if (!bare.has(spec)) bare.set(spec, file);
    }
  }
  return { files, bare };
}

describe('core subpath is React-free (Node-importable without React)', () => {
  it('no module in the core.ts import closure imports React / a DOM-UI dependency', () => {
    const { files, bare } = closure(resolve(HERE, 'core.ts'));

    // A `.tsx` file reachable from core.ts is itself a red flag (React components live in .tsx).
    const tsxReached = [...files].filter((f) => f.endsWith('.tsx'));
    expect(tsxReached, `core.ts must not reach any .tsx: ${tsxReached.join(', ')}`).toEqual([]);

    // No React-coupled bare import anywhere in the closure.
    const offenders = [...bare.entries()].filter(([spec]) =>
      REACT_COUPLED.some((p) => spec === p || spec.startsWith(`${p}/`)),
    );
    expect(
      offenders,
      `React-coupled imports in core closure: ${offenders
        .map(([spec, f]) => `${spec} (in ${f})`)
        .join('; ')}`,
    ).toEqual([]);

    // The closure must be non-trivial (guards against a resolver mistake silently passing).
    expect(files.size).toBeGreaterThan(10);
    // Its only runtime bare deps are the CRDT + validation libs.
    expect([...bare.keys()].sort()).toEqual(['y-protocols/awareness', 'yjs', 'zod']);
  });

  it('the compiled dist/core.js closure carries the same React-free graph (when built)', () => {
    const distEntry = resolve(HERE, '..', 'dist', 'core.js');
    if (!existsSync(distEntry)) {
      // `build` runs after `test` in CI; skip rather than fail when dist is not present yet.
      return;
    }
    const files = new Set<string>();
    const stack = [distEntry];
    const bare = new Set<string>();
    while (stack.length) {
      const file = stack.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) {
          const p = resolve(dirname(file), spec.endsWith('.js') ? spec : `${spec}.js`);
          if (existsSync(p)) stack.push(p);
        } else bare.add(spec);
      }
    }
    const offenders = [...bare].filter((spec) =>
      REACT_COUPLED.some((p) => spec === p || spec.startsWith(`${p}/`)),
    );
    expect(offenders, `React in dist/core.js closure: ${offenders.join(', ')}`).toEqual([]);
  });
});
