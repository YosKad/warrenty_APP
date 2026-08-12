import { productDraftSchema, isPurchaseDateSuspicious } from '../product';

/**
 * Product form validation. These rules exist to stop a bad OCR read or a slip of the
 * thumb becoming a warranty date the user later relies on.
 */

const categoryId = '3a7c1f9e-2b4d-4e6f-8a1b-2c3d4e5f6071';

const base = {
  name: 'Samsung OLED S95D',
  categoryId,
  purchaseDate: '2026-05-20',
  countryCode: 'IL',
};

describe('productDraftSchema', () => {
  it('accepts the minimum viable product: name, category, purchase date', () => {
    const result = productDraftSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('requires a name', () => {
    const result = productDraftSchema.safeParse({ ...base, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed purchase date', () => {
    expect(productDraftSchema.safeParse({ ...base, purchaseDate: '20/05/2026' }).success).toBe(
      false,
    );
    expect(productDraftSchema.safeParse({ ...base, purchaseDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('requires a currency alongside a price', () => {
    // A bare number is unusable: we could neither display nor convert it.
    const withoutCurrency = productDraftSchema.safeParse({ ...base, purchasePrice: 4999 });
    expect(withoutCurrency.success).toBe(false);

    const withCurrency = productDraftSchema.safeParse({
      ...base,
      purchasePrice: 4999,
      currency: 'ILS',
    });
    expect(withCurrency.success).toBe(true);
  });

  it('rejects a negative price', () => {
    expect(
      productDraftSchema.safeParse({ ...base, purchasePrice: -1, currency: 'ILS' }).success,
    ).toBe(false);
  });

  it('rejects a warranty start before the purchase date', () => {
    const result = productDraftSchema.safeParse({ ...base, warrantyStart: '2026-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('validation.warrantyStartBeforePurchase');
    }
  });

  it('rejects a warranty end before it starts', () => {
    const result = productDraftSchema.safeParse({ ...base, warrantyEnd: '2026-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('validation.warrantyEndBeforeStart');
    }
  });

  it('accepts a delivery-dated warranty start after purchase', () => {
    const result = productDraftSchema.safeParse({
      ...base,
      warrantyStart: '2026-06-10',
      warrantyEnd: '2028-06-10',
    });
    expect(result.success).toBe(true);
  });

  it('normalises blank optional fields to undefined', () => {
    const result = productDraftSchema.safeParse({ ...base, model: '', notes: '  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it('uppercases the country code', () => {
    const result = productDraftSchema.safeParse({ ...base, countryCode: 'il' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe('IL');
  });

  it('rejects a serial number containing characters no serial has', () => {
    expect(
      productDraftSchema.safeParse({ ...base, serialNumber: '### bad ###' }).success,
    ).toBe(false);
    expect(
      productDraftSchema.safeParse({ ...base, serialNumber: 'RZ8N40FKT9L' }).success,
    ).toBe(true);
  });

  it('bounds the warranty duration to something plausible', () => {
    expect(
      productDraftSchema.safeParse({ ...base, warrantyDurationMonths: 24 }).success,
    ).toBe(true);
    expect(
      productDraftSchema.safeParse({ ...base, warrantyDurationMonths: 0 }).success,
    ).toBe(false);
    expect(
      productDraftSchema.safeParse({ ...base, warrantyDurationMonths: 1200 }).success,
    ).toBe(false);
    expect(
      productDraftSchema.safeParse({ ...base, warrantyDurationMonths: 18.5 }).success,
    ).toBe(false);
  });
});

describe('isPurchaseDateSuspicious', () => {
  it('flags a future date so the user can confirm it', () => {
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    expect(isPurchaseDateSuspicious(nextYear, 'UTC')).toBe(true);
  });

  it('accepts a past date without comment', () => {
    expect(isPurchaseDateSuspicious('2020-01-01', 'UTC')).toBe(false);
  });
});
