import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const read = (file: string) =>
  readFileSync(path.join(root, file), 'utf8');

const artifact = () =>
  read(
    'supabase/candidates/20261028000000_packages_search_promotion_production.sql',
  );

const legacyRpc = () => {
  const source = read('sql/122_thai_search_normalize.sql');
  const start = source.indexOf(
    'create or replace function search_packages_thai(',
  );
  if (start < 0) throw new Error('Repository legacy RPC not found');

  return source.slice(start, source.indexOf('$$;', start) + 3);
};

const replacementBlock = (sql: string) =>
  sql.split('replacement_ddl := $replacement$')[1].split('$replacement$;')[0];

describe('standalone production Phase 2 artifact contract', () => {
  it('replaces only the promotion storage source in the repository RPC', () => {
    const expected = legacyRpc()
      .replace(
        'function search_packages_thai(',
        'function public.search_packages_thai(',
      )
      .replace('p.is_promotion,', 'p.promotion,');

    const sql = artifact();
    const ddl = replacementBlock(sql);

    expect(ddl).toContain(expected);
  });

  it('preserves the existing RPC interface and security contract', () => {
    const sql = artifact();

    expect(sql).toContain(
      'create or replace function public.search_packages_thai(',
    );
    expect(sql).toContain('search_term text');
    expect(sql).toContain('result_limit integer');
    expect(sql).toContain('returns table');
    expect(sql).toContain('is_promotion boolean');
    expect(sql).toContain('duration text');
    expect(sql).toMatch(
      /p\.prosecdef\s+or\s+p\.provolatile\s*<>\s*'s'\s+or\s+p\.proconfig\s+is\s+not\s+null/,
    );
  });

  it('uses canonical promotion storage while preserving the compatibility output name', () => {
    const sql = artifact();
    const replacement = replacementBlock(sql);

    expect(replacement).toContain('p.promotion,');
    expect(replacement).not.toContain('p.is_promotion,');
    expect(replacement).toContain('is_promotion boolean');
  });

  it('preserves the existing search behavior', () => {
    const sql = artifact();

    expect(sql).toContain('strip_thai_tone_marks');
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain('p.is_active');
    expect(sql).toContain("pt.status = 'active'");
    expect(sql).toContain('order by p.title asc');
    expect(sql).toContain('limit result_limit');
  });

  it('contains no disposable-local or destructive migration operations', () => {
    const sql = artifact();

    expect(sql).not.toMatch(
      /disposable-local|wos_promotion_disposable|WOS_PROMOTION_DISPOSABLE/i,
    );
    expect(sql).not.toMatch(
      /\b(drop|rename|grant|revoke)\s+(function|table|execute)\b/i,
    );
  });

  it('does not introduce a second RPC signature', () => {
    const sql = artifact();

    expect(
      (replacementBlock(sql).match(/create\s+or\s+replace\s+function/gi) ?? []).length,
    ).toBe(1);

    expect(sql).toContain(
      'public.search_packages_thai(text,integer)',
    );
  });
});
