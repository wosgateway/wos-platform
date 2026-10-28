import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

function writer(role: 'admin' | 'partner', promotion: boolean, update = true) {
  const source = read(`src/components/${role}/PackagesManager.tsx`);
  const tree = ts.createSourceFile(
    'writer.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  let handler: ts.FunctionDeclaration | undefined;

  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'handleSubmit'
    ) {
      handler = node;
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);

  if (!handler) {
    throw new Error('Actual handleSubmit not found');
  }

  const js = ts.transpileModule(handler.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const calls: Array<{
    operation: 'update' | 'insert';
    payload: Record<string, unknown>;
  }> = [];

  type WriterChain = {
    from(table: string): WriterChain;
    update(payload: Record<string, unknown>): WriterChain;
    insert(payload: Record<string, unknown>): WriterChain;
    eq(): WriterChain;
    select(): WriterChain;
    then(resolve: (value: unknown) => unknown): unknown;
  };

  const chain: WriterChain = {
    from: (table: string) => {
      if (table !== 'packages') throw new Error('Unexpected table');
      return chain;
    },
    update: (payload: Record<string, unknown>) => {
      calls.push({ operation: 'update', payload });
      return chain;
    },
    insert: (payload: Record<string, unknown>) => {
      calls.push({ operation: 'insert', payload });
      return chain;
    },
    eq: () => chain,
    select: () => chain,
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ error: null, data: [{ id: 'fixture' }] }),
  };

  const form = {
    id: update ? 'fixture' : null,
    partner_id: 'partner',
    title: '???????',
    description: '',
    image_url: '',
    original_price: '100',
    special_price: '80',
    duration: null,
    is_promotion: promotion,
    suggested_hotel_name: '',
    suggested_hotel_price_note: '',
    sub_category: '',
    max_guests: '',
    amenities: [],
    gallery_urls: [],
  };

  const noop = () => {};

  const scope: Record<string, unknown> = {
    form,
    supabase: chain,
    partnerId: 'partner',
    partnerCategory: 'Hospital',
    partners: [{ id: 'partner', category: 'Hospital' }],
    uploading: false,
    setFormError: (value: unknown) => {
      if (value) throw new Error(String(value));
    },
    setSaving: noop,
    setModalOpen: noop,
    setShowForm: noop,
    setForm: noop,
    loadAll: noop,
    loadPackages: noop,
    emptyForm: form,
  };

  const run = new Function(
    ...Object.keys(scope),
    `${js};return handleSubmit;`,
  )(...Object.values(scope));

  return run({ preventDefault: noop }).then(() => {
    if (calls.length !== 1) {
      throw new Error('Expected one actual writer call');
    }
    return calls[0];
  });
}

describe('actual Admin/Partner save handlers', () => {
  for (const role of ['admin', 'partner'] as const) {
    for (const flag of [true, false]) {
      for (const update of [true, false]) {
        it(
          role + ' ' + flag + ' ' + (update ? 'update' : 'insert'),
          async () => {
            const call = await writer(role, flag, update);

            expect(call.operation).toBe(update ? 'update' : 'insert');
            expect(call.payload.promotion).toBe(flag);
            expect(call.payload).not.toHaveProperty('is_promotion');
            expect(call.payload.status).toBe(
              role === 'admin' ? 'published' : 'pending',
            );
          },
        );
      }
    }
  }
});
