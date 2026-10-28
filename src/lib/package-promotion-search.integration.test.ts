import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const read = (file: string) =>
  readFileSync(path.join(root, file), 'utf8');

const replacementBlock = (sql: string) =>
  sql.split('replacement_ddl := $replacement$')[1].split('$replacement$;')[0];

describe('package promotion search repository contract', () => {
  it('application writers persist canonical promotion only', () => {
    for (const role of ['admin', 'partner'] as const) {
      const source = read(`src/components/${role}/PackagesManager.tsx`);

      expect(source).toContain('promotion: form.is_promotion');
      expect(source).not.toContain('is_promotion: form.is_promotion');
    }
  });

  it('search RPC consumes canonical promotion storage', () => {
    const artifact = read(
      'supabase/candidates/20261028000000_packages_search_promotion_production.sql',
    );
    const replacement = replacementBlock(artifact);

    expect(replacement).toContain('p.promotion,');
    expect(replacement).not.toContain('p.is_promotion,');
    expect(replacement).toContain('is_promotion boolean');
  });

  it('search RPC preserves compatibility output for existing consumers', () => {
    const artifact = read(
      'supabase/candidates/20261028000000_packages_search_promotion_production.sql',
    );

    expect(artifact).toContain('is_promotion boolean');
    expect(artifact).toContain('duration text');
  });

  it('search RPC retains visibility and ranking semantics', () => {
    const artifact = read(
      'supabase/candidates/20261028000000_packages_search_promotion_production.sql',
    );

    expect(artifact).toContain("p.status = 'published'");
    expect(artifact).toContain('p.is_active');
    expect(artifact).toContain("pt.status = 'active'");
    expect(artifact).toContain('order by p.title asc');
    expect(artifact).toContain('limit result_limit');
    expect(artifact).toContain('strip_thai_tone_marks');
  });

  it('Phase 1 establishes canonical promotion from legacy storage', () => {
    const migration = read(
      'supabase/candidates/20261027000000_packages_promotion_upgrade.sql',
    );

    expect(migration).toMatch(
      /add column if not exists\s+promotion\s+boolean/i,
    );
    expect(migration).toMatch(
      /set\s+promotion\s*=\s*coalesce\(is_promotion,\s*false\)/i,
    );
    expect(migration).toMatch(
      /alter column promotion set default false/i,
    );
    expect(migration).toMatch(
      /alter column promotion set not null/i,
    );
  });

  it('does not make the disposable-local migration part of the production artifact', () => {
    const artifact = read(
      'supabase/candidates/20261028000000_packages_search_promotion_production.sql',
    );

    expect(artifact).not.toContain(
      '20261027000001_packages_search_promotion_canonical.sql',
    );
    expect(artifact).not.toMatch(
      /WOS_PROMOTION_DISPOSABLE|wos_promotion_disposable|disposable-local/i,
    );
  });

  it('preserves the canonical application boundary', () => {
    const contract = read('src/lib/data-canonical-contract.test.ts');

    expect(contract).toContain('search_packages_thai');
    expect(contract).toContain('is_promotion');
  });
});
