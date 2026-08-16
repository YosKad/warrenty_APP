import { supabaseServer } from './supabase/server';

/**
 * Corpus coverage.
 *
 * Two columns, deliberately. "Records in the database" is a number that always
 * goes up; what an operator needs to know is how much of it a user can actually
 * be shown, and how much is sitting in a queue waiting for a person. Demo
 * fixtures appear in neither.
 */

export type CoverageRow = {
  label: string;
  published: number;
  inReview: number;
};

const TABLES: { table: string; label: string }[] = [
  { table: 'organisations', label: 'Organisations' },
  { table: 'organisation_relationships', label: 'Relationships' },
  { table: 'warranties', label: 'Warranty policies' },
  { table: 'warranty_terms', label: 'Clauses' },
  { table: 'warranty_sources', label: 'Sources' },
  { table: 'provider_contact_methods', label: 'Contact methods' },
  { table: 'service_locations', label: 'Service locations' },
  { table: 'service_capabilities', label: 'Capabilities' },
];

export async function corpusCoverage(): Promise<CoverageRow[]> {
  const supabase = await supabaseServer();
  const head = { count: 'exact' as const, head: true };

  const results = await Promise.all(
    TABLES.map(async ({ table, label }) => {
      const [published, inReview] = await Promise.all([
        supabase
          .from(table)
          .select('id', head)
          .eq('publication_status', 'published')
          .eq('data_environment', 'production'),
        supabase
          .from(table)
          .select('id', head)
          .in('publication_status', ['candidate', 'needs_review', 'needs_reverification'])
          .eq('data_environment', 'production'),
      ]);

      return {
        label,
        published: published.count ?? 0,
        inReview: inReview.count ?? 0,
      };
    }),
  );

  return results;
}

/**
 * Coverage per brand: the view that tells an operator which brand to work on.
 *
 * A brand is only "covered" when the chain behind it is complete — a policy is
 * useless without someone who honours it and a way to reach them, which is the
 * same conjunction the Full Resolution Rate measures.
 */
export type BrandCoverage = {
  brandId: string;
  brandName: string;
  policies: number;
  clauses: number;
  relationships: number;
  contacts: number;
  locations: number;
};

export async function brandCoverage(countryCode = 'IL'): Promise<BrandCoverage[]> {
  const supabase = await supabaseServer();

  const { data } = await supabase.rpc('brand_corpus_coverage', {
    p_country_code: countryCode,
  });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    brandId: String(row.brand_id),
    brandName: String(row.brand_name),
    policies: Number(row.policies ?? 0),
    clauses: Number(row.clauses ?? 0),
    relationships: Number(row.relationships ?? 0),
    contacts: Number(row.contacts ?? 0),
    locations: Number(row.locations ?? 0),
  }));
}
