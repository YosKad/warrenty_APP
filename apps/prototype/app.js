/* ==========================================================================
   MY Warranty — interactive prototype

   A faithful, playable version of the mobile app for a browser. The domain
   logic below is ported directly from apps/mobile/src/domain — same warranty
   maths, same entitlement rules, same paywall behaviour — so what you get is a
   real prototype rather than a slideshow of mockups.

   What is genuinely real here:
     · calendar-date warranty arithmetic, including month-end clamping
     · status thresholds and days-remaining
     · plan limits, the paywall trigger, and the draft-survives-the-paywall rule
     · form validation
     · English/Hebrew with actual RTL

   What is simulated, because there is no backend or model behind this file:
     · sign-in accepts anything
     · coverage analysis is keyword-driven, not a model call
     · receipt scanning is not wired up
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------- domain --
   Ported from src/domain/date.ts and src/domain/warranty.ts. Kept pure. */

function daysInMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function toISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isCalendarDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function parseDate(v) {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 31 Jan + 1 month = 28 Feb. What "one month later" means to a consumer. */
function addMonths(date, months) {
  const p = parseDate(date);
  const idx = p.getUTCMonth() + months;
  const year = p.getUTCFullYear() + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const day = Math.min(p.getUTCDate(), daysInMonth(year, month + 1));
  return toISO(new Date(Date.UTC(year, month, day)));
}

function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

function today() {
  return toISO(new Date());
}

const ENDING_SOON_DAYS = 30;

/**
 * The warranty status engine. An explicit end date wins; otherwise start plus
 * duration plus any extension. If neither is known the answer is `unknown` —
 * never a guessed twelve months.
 */
function snapshot(product, asOf) {
  const start = product.warrantyStart || product.purchaseDate || null;
  let end = product.warrantyEnd || null;
  let derived = false;

  if (!end && start && product.durationMonths) {
    end = addMonths(start, product.durationMonths + (product.extensionMonths || 0));
    derived = true;
  }
  if (!end) {
    return { status: 'unknown', start, end: null, daysRemaining: null, progress: null, derived };
  }

  const daysRemaining = daysBetween(asOf, end);
  const status =
    daysRemaining < 0 ? 'expired' : daysRemaining <= ENDING_SOON_DAYS ? 'ending_soon' : 'active';

  let progress = null;
  if (start) {
    const total = daysBetween(start, end);
    progress = total <= 0 ? 1 : Math.min(1, Math.max(0, daysBetween(start, asOf) / total));
  }
  return { status, start, end, daysRemaining, progress, derived };
}

/* Entitlements — ported from src/domain/entitlements.ts */
const PLANS = {
  free: { limit: 3, aiCoverage: false, smartScan: false },
  plus: { limit: 20, aiCoverage: true, smartScan: true },
  pro: { limit: null, aiCoverage: true, smartScan: true },
};

function canAddProduct(plan, count) {
  const limit = PLANS[plan].limit;
  if (limit === null) return { allowed: true };
  if (count < limit) return { allowed: true };
  return { allowed: false, limit, suggested: plan === 'free' ? 'plus' : 'pro' };
}

/* ------------------------------------------------------------------ i18n -- */

const STRINGS = {
  en: {
    dir: 'ltr', locale: 'en-GB',
    greetMorning: 'Good morning', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening',
    protected_one: '{n} product is currently protected',
    protected_other: '{n} products are currently protected',
    noProducts: 'Add your first product to get started',
    active: 'Active', endingSoon: 'Ending soon', expired: 'Expired', unknownStatus: 'Warranty not set',
    attention: 'Needs your attention', reviewWarranty: 'Review warranty',
    protectionTitle: 'Protection score', claimReady: 'claim ready',
    bandStrong: 'Your records are in good shape',
    bandFair: 'A few details are still missing',
    bandNeedsAttention: 'Key details are missing',
    bandEmpty: 'Add a product to start tracking',
    tracked_one: '{n} product tracked', tracked_other: '{n} products tracked',
    recommendedActions: 'Recommended actions',
    recommendedSub: 'Each one makes a claim easier to file',
    allOnFile: 'Everything we need is on file',
    claimReadiness: 'Claim readiness',
    gapsLeft_one: '{n} detail missing', gapsLeft_other: '{n} details missing',
    yourProducts: 'Your products',
    protectedShort: 'Protected', endingShort: 'Ending soon',
    expiredShort: 'Expired', unknownShort: 'Warranty not set',
    pfPurchase_date: 'Purchase date', pfWarranty_end: 'Warranty end date',
    pfProof_of_purchase: 'Proof of purchase', pfWarranty_provider: 'Warranty provider',
    pfWarranty_terms: 'Warranty terms', pfSerial_number: 'Serial number',
    pfService_provider: 'Service contact', pfModel: 'Model number',
    paPurchase_date: 'Add the purchase date', paWarranty_end: 'Add when the warranty ends',
    paProof_of_purchase: 'Attach the receipt', paWarranty_provider: 'Add who provides the warranty',
    paWarranty_terms: 'Add the warranty terms', paSerial_number: 'Add the serial number',
    paService_provider: 'Add a service contact', paModel: 'Add the model number',
    recentlyAdded: 'Recently added', seeAll: 'See all', addProduct: 'Add a product',
    slotsUsed: '{used} of {limit} products used',
    myProducts: 'My products', searchPlaceholder: 'Search products, brands, models',
    all: 'All', emptyTitle: 'No products yet',
    emptyBody: 'Your warranties will appear here once you add something.',
    emptyCta: 'Add your first product',
    noMatchTitle: 'No matches', noMatchBody: 'Try a different search or clear your filters.',
    clear: 'Clear',
    daysRemaining_one: '{n} day remaining', daysRemaining_other: '{n} days remaining',
    expiredAgo_one: 'Expired {n} day ago', expiredAgo_other: 'Expired {n} days ago',
    endsOn: 'Ends {d}', endsIn_one: '{name} warranty ends in {n} day',
    endsIn_other: '{name} warranty ends in {n} days',
    timeline: 'Warranty timeline', purchased: 'Purchased', warrantyEnds: 'Warranty ends',
    boughtAt: 'Bought at', price: 'Price', model: 'Model', serial: 'Serial number',
    purchase: 'Purchase', details: 'Details', notes: 'Notes',
    reportProblem: 'Report a problem', edit: 'Edit', del: 'Delete',
    deleteTitle: 'Delete this product?',
    deleteBody: 'Its documents and history will be removed from your account.',
    cancel: 'Cancel', save: 'Save', done: 'Done', back: 'Back', close: 'Close',
    addTitle: 'Add a product', addSubtitle: "Choose how you'd like to start",
    mScan: 'Scan receipt', mScanB: "We'll read the details from the receipt",
    mBarcode: 'Scan barcode', mBarcodeB: 'Identify the product automatically',
    mPhoto: 'Take a photo', mPhotoB: 'Snap the product and fill in the rest',
    mManual: 'Enter manually', mManualB: 'Type in the details yourself',
    fName: 'Product name', fNamePh: 'e.g. Samsung OLED S95D', fCategory: 'Category',
    fBrand: 'Brand', fModel: 'Model', fPurchaseDate: 'Purchase date', fRetailer: 'Bought at',
    fPrice: 'Price', fWarranty: 'Warranty length', fSerial: 'Serial number', fNotes: 'Notes',
    basics: 'The basics', warrantySec: 'Warranty', extras: 'Extras',
    months_one: '{n} month', months_other: '{n} months',
    saveProduct: 'Save product', optional: 'Optional', notSet: 'Not set',
    required: 'This is required', invalidDate: 'Use a valid date (YYYY-MM-DD)',
    endBeforeStart: "Warranty can't end before it starts",
    savedToast: 'Product saved', deletedToast: 'Product deleted',
    alerts: 'Alerts', alertsEmptyT: 'Nothing needs you right now',
    alertsEmptyB: "We'll let you know before any warranty runs out.",
    markAllRead: 'Mark all as read',
    alertTitle: '{name} warranty ends soon',
    alertBody_one: "Cover ends in {n} day. If you've noticed an issue, now may be the time to check coverage.",
    alertBody_other: "Cover ends in {n} days. If you've noticed an issue, now may be the time to check coverage.",
    profile: 'Profile', account: 'Account', preferences: 'Preferences',
    appearance: 'Appearance', language: 'Language', subscription: 'Subscription',
    plan: 'Plan', currentPlan: 'Current plan', changePlan: 'Change plan',
    themeLight: 'Light', themeDark: 'Dark',
    about: 'About this prototype', resetData: 'Reset all data',
    resetTitle: 'Reset the prototype?', resetBody: 'This restores the sample products and clears anything you added.',
    coverage: 'Coverage check', describeTitle: "What's happening?",
    describeBody: 'Describe the problem in your own words.',
    describePh: 'e.g. My washing machine makes a loud noise during the spin cycle',
    categoryLabel: 'What kind of problem?', analyse: 'Check coverage',
    analysing: 'Checking your warranty…',
    vLikely: 'Likely covered', vPossibly: 'Possibly covered',
    vNot: 'Likely not covered', vInsufficient: 'Not enough information',
    whyThis: 'Why we think this', relevantClauses: 'Relevant warranty terms',
    watchOut: 'Watch out for', nextStep: 'What to do next',
    disclaimer: 'Coverage assessments are based on available warranty documentation and do not constitute a guarantee that a manufacturer or service provider will approve a claim.',
    checkAnother: 'Check something else',
    limitTitle: "You've reached your {limit}-product limit",
    limitBody: "Upgrade to keep adding products. Everything you've already saved stays exactly where it is.",
    draftKept: "We've kept what you entered.",
    recommended: 'Recommended', upgrade: 'Upgrade', notNow: 'Not now',
    coverageLocked: 'Coverage checks are part of Plus',
    scanLocked: 'Receipt scanning is part of Plus',
    freeF: 'Up to 3 products · Manual entry · Receipt storage · Expiry reminders',
    plusF: 'Up to 20 products · Coverage checks · Receipt scanning · Automatic warranty detection',
    proF: 'Unlimited products · Priority coverage checks · Full warranty archive',
    tabHome: 'Home', tabProducts: 'Products', tabAdd: 'Add', tabAlerts: 'Alerts', tabProfile: 'Profile',
    sourceUser: 'You entered this', sourceMfr: 'Manufacturer warranty terms',
    confHigh: 'Confirmed', confLow: 'Unverified',
    notWired: 'Not wired up in this prototype — use "Enter manually".',
    downgradeNote: "You have {n} products. On Free you can view and edit them all, but you won't be able to add more until you upgrade.",
  },
  he: {
    dir: 'rtl', locale: 'he-IL',
    greetMorning: 'בוקר טוב', greetAfternoon: 'צהריים טובים', greetEvening: 'ערב טוב',
    protected_one: 'מוצר אחד מוגן כרגע',
    protected_other: '{n} מוצרים מוגנים כרגע',
    noProducts: 'הוסיפו מוצר ראשון כדי להתחיל',
    active: 'בתוקף', endingSoon: 'מסתיימת בקרוב', expired: 'פגה', unknownStatus: 'האחריות לא הוגדרה',
    attention: 'דורש תשומת לב', reviewWarranty: 'בדיקת האחריות',
    protectionTitle: 'ציון הגנה', claimReady: 'מוכן לתביעה',
    bandStrong: 'התיעוד שלכם במצב טוב',
    bandFair: 'עדיין חסרים כמה פרטים',
    bandNeedsAttention: 'חסרים פרטים חשובים',
    bandEmpty: 'הוסיפו מוצר כדי להתחיל לעקוב',
    tracked_one: 'מוצר אחד במעקב', tracked_other: '{n} מוצרים במעקב',
    recommendedActions: 'פעולות מומלצות',
    recommendedSub: 'כל אחת מהן מקלה על הגשת תביעה',
    allOnFile: 'כל מה שצריך נמצא אצלנו',
    claimReadiness: 'מוכנות לתביעה',
    gapsLeft_one: 'חסר פרט אחד', gapsLeft_other: 'חסרים {n} פרטים',
    yourProducts: 'המוצרים שלכם',
    protectedShort: 'מוגן', endingShort: 'מסתיים בקרוב',
    expiredShort: 'פג', unknownShort: 'האחריות לא הוגדרה',
    pfPurchase_date: 'תאריך רכישה', pfWarranty_end: 'מועד סיום האחריות',
    pfProof_of_purchase: 'הוכחת רכישה', pfWarranty_provider: 'נותן האחריות',
    pfWarranty_terms: 'תנאי האחריות', pfSerial_number: 'מספר סידורי',
    pfService_provider: 'איש קשר לשירות', pfModel: 'מספר דגם',
    paPurchase_date: 'הוספת תאריך הרכישה', paWarranty_end: 'הוספת מועד סיום האחריות',
    paProof_of_purchase: 'צירוף הקבלה', paWarranty_provider: 'הוספת נותן האחריות',
    paWarranty_terms: 'הוספת תנאי האחריות', paSerial_number: 'הוספת המספר הסידורי',
    paService_provider: 'הוספת איש קשר לשירות', paModel: 'הוספת מספר הדגם',
    recentlyAdded: 'נוספו לאחרונה', seeAll: 'הצג הכול', addProduct: 'הוספת מוצר',
    slotsUsed: '{used} מתוך {limit} מוצרים בשימוש',
    myProducts: 'המוצרים שלי', searchPlaceholder: 'חיפוש מוצרים, מותגים, דגמים',
    all: 'הכול', emptyTitle: 'עדיין אין מוצרים',
    emptyBody: 'האחריויות שלכם יופיעו כאן אחרי שתוסיפו מוצר.',
    emptyCta: 'הוספת מוצר ראשון',
    noMatchTitle: 'אין תוצאות', noMatchBody: 'נסו חיפוש אחר או נקו את הסינון.',
    clear: 'ניקוי',
    daysRemaining_one: 'נותר יום אחד', daysRemaining_other: 'נותרו {n} ימים',
    expiredAgo_one: 'פגה לפני יום', expiredAgo_other: 'פגה לפני {n} ימים',
    endsOn: 'מסתיימת ב-{d}', endsIn_one: 'האחריות של {name} מסתיימת בעוד יום',
    endsIn_other: 'האחריות של {name} מסתיימת בעוד {n} ימים',
    timeline: 'ציר הזמן של האחריות', purchased: 'נרכש', warrantyEnds: 'סיום האחריות',
    boughtAt: 'נרכש ב', price: 'מחיר', model: 'דגם', serial: 'מספר סידורי',
    purchase: 'רכישה', details: 'פרטים', notes: 'הערות',
    reportProblem: 'דיווח על תקלה', edit: 'עריכה', del: 'מחיקה',
    deleteTitle: 'למחוק את המוצר?',
    deleteBody: 'המסמכים וההיסטוריה שלו יוסרו מהחשבון שלך.',
    cancel: 'ביטול', save: 'שמירה', done: 'סיום', back: 'חזרה', close: 'סגירה',
    addTitle: 'הוספת מוצר', addSubtitle: 'איך תרצו להתחיל?',
    mScan: 'סריקת קבלה', mScanB: 'נקרא את הפרטים מהקבלה',
    mBarcode: 'סריקת ברקוד', mBarcodeB: 'זיהוי אוטומטי של המוצר',
    mPhoto: 'צילום תמונה', mPhotoB: 'צלמו את המוצר והשלימו את השאר',
    mManual: 'הזנה ידנית', mManualB: 'הקלידו את הפרטים בעצמכם',
    fName: 'שם המוצר', fNamePh: 'לדוגמה: Samsung OLED S95D', fCategory: 'קטגוריה',
    fBrand: 'מותג', fModel: 'דגם', fPurchaseDate: 'תאריך רכישה', fRetailer: 'נרכש ב',
    fPrice: 'מחיר', fWarranty: 'משך האחריות', fSerial: 'מספר סידורי', fNotes: 'הערות',
    basics: 'פרטים בסיסיים', warrantySec: 'אחריות', extras: 'נוסף',
    months_one: 'חודש', months_other: '{n} חודשים',
    saveProduct: 'שמירת המוצר', optional: 'לא חובה', notSet: 'לא הוגדר',
    required: 'שדה חובה', invalidDate: 'הזינו תאריך תקין (YYYY-MM-DD)',
    endBeforeStart: 'האחריות לא יכולה להסתיים לפני שהתחילה',
    savedToast: 'המוצר נשמר', deletedToast: 'המוצר נמחק',
    alerts: 'התראות', alertsEmptyT: 'אין כרגע מה לטפל',
    alertsEmptyB: 'נעדכן אתכם לפני שאחריות כלשהי מסתיימת.',
    markAllRead: 'סימון הכול כנקרא',
    alertTitle: 'האחריות של {name} מסתיימת בקרוב',
    alertBody_one: 'הכיסוי מסתיים בעוד יום. אם שמתם לב לתקלה, זה הזמן לבדוק את הכיסוי.',
    alertBody_other: 'הכיסוי מסתיים בעוד {n} ימים. אם שמתם לב לתקלה, זה הזמן לבדוק את הכיסוי.',
    profile: 'פרופיל', account: 'חשבון', preferences: 'העדפות',
    appearance: 'מראה', language: 'שפה', subscription: 'מנוי',
    plan: 'מסלול', currentPlan: 'המסלול הנוכחי', changePlan: 'החלפת מסלול',
    themeLight: 'בהיר', themeDark: 'כהה',
    about: 'על האב-טיפוס', resetData: 'איפוס כל הנתונים',
    resetTitle: 'לאפס את האב-טיפוס?', resetBody: 'הפעולה משחזרת את מוצרי הדוגמה ומוחקת את מה שהוספתם.',
    coverage: 'בדיקת כיסוי', describeTitle: 'מה קרה?',
    describeBody: 'תארו את התקלה במילים שלכם.',
    describePh: 'לדוגמה: מכונת הכביסה משמיעה רעש חזק בסחיטה',
    categoryLabel: 'איזה סוג תקלה?', analyse: 'בדיקת כיסוי',
    analysing: 'בודקים את האחריות…',
    vLikely: 'כנראה מכוסה', vPossibly: 'ייתכן שמכוסה',
    vNot: 'כנראה לא מכוסה', vInsufficient: 'אין מספיק מידע',
    whyThis: 'למה אנחנו חושבים כך', relevantClauses: 'סעיפי אחריות רלוונטיים',
    watchOut: 'שימו לב', nextStep: 'מה לעשות עכשיו',
    disclaimer: 'הערכות הכיסוי מבוססות על מסמכי האחריות הזמינים ואינן מהוות התחייבות שהיצרן או נותן השירות יאשרו את התביעה.',
    checkAnother: 'בדיקה נוספת',
    limitTitle: 'הגעתם למגבלה של {limit} מוצרים',
    limitBody: 'שדרגו כדי להמשיך להוסיף מוצרים. כל מה ששמרתם עד עכשיו נשאר בדיוק במקום.',
    draftKept: 'שמרנו את מה שהזנתם.',
    recommended: 'מומלץ', upgrade: 'שדרוג', notNow: 'לא עכשיו',
    coverageLocked: 'בדיקת כיסוי כלולה ב-Plus',
    scanLocked: 'סריקת קבלות כלולה ב-Plus',
    freeF: 'עד 3 מוצרים · הזנה ידנית · שמירת קבלות · תזכורות',
    plusF: 'עד 20 מוצרים · בדיקות כיסוי · סריקת קבלות · זיהוי אחריות אוטומטי',
    proF: 'מוצרים ללא הגבלה · בדיקות בעדיפות · ארכיון מלא',
    tabHome: 'בית', tabProducts: 'מוצרים', tabAdd: 'הוספה', tabAlerts: 'התראות', tabProfile: 'פרופיל',
    sourceUser: 'הזנתם ידנית', sourceMfr: 'תנאי אחריות היצרן',
    confHigh: 'מאומת', confLow: 'לא מאומת',
    notWired: 'לא מחובר באב-טיפוס — השתמשו ב״הזנה ידנית״.',
    downgradeNote: 'יש לכם {n} מוצרים. במסלול החינמי אפשר לצפות ולערוך את כולם, אך לא להוסיף חדשים עד לשדרוג.',
  },
};

function t(key, vars) {
  const dict = STRINGS[S.lang] || STRINGS.en;
  let s = dict[key];
  if (s === undefined) s = STRINGS.en[key];
  if (s === undefined) return key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

/** Plural selection. Hebrew uses the same one/other split we need here. */
function tn(base, n, vars) {
  const key = n === 1 ? base + '_one' : base + '_other';
  return t(key, Object.assign({ n: n }, vars || {}));
}

const CATEGORIES = [
  { slug: 'electronics', en: 'Electronics', he: 'אלקטרוניקה', months: 24 },
  { slug: 'appliances', en: 'Appliances', he: 'מוצרי חשמל', months: 24 },
  { slug: 'computers', en: 'Computers', he: 'מחשבים', months: 12 },
  { slug: 'phones', en: 'Phones', he: 'טלפונים', months: 12 },
  { slug: 'furniture', en: 'Furniture', he: 'רהיטים', months: 60 },
  { slug: 'tools', en: 'Tools', he: 'כלי עבודה', months: 24 },
  { slug: 'automotive', en: 'Automotive', he: 'אביזרי רכב', months: 12 },
  { slug: 'baby', en: 'Baby products', he: 'מוצרי תינוקות', months: 24 },
  { slug: 'watches', en: 'Watches', he: 'שעונים', months: 24 },
  { slug: 'other', en: 'Other', he: 'אחר', months: null },
];

function catLabel(slug) {
  const c = CATEGORIES.find((x) => x.slug === slug);
  if (!c) return slug;
  return S.lang === 'he' ? c.he : c.en;
}

/* ----------------------------------------------------------------- state -- */

const STORE_KEY = 'mw.prototype.v2';

function seedProducts() {
  const now = new Date();
  const iso = (offsetDays) => toISO(new Date(now.getTime() + offsetDays * 86400000));
  return [
    {
      id: 'p1', name: 'Samsung OLED S95D', brand: 'Samsung', model: 'QE65S95D',
      category: 'electronics', purchaseDate: iso(-712), durationMonths: 24,
      retailer: 'KSP', price: 8490, currency: 'ILS', serial: 'RZ8N40FKT9L',
      source: 'manufacturer', verified: true, notes: '', createdAt: Date.now() - 4000,
      hasReceipt: true, warrantyProvider: 'Samsung Israel', serviceProvider: '',
    },
    {
      id: 'p2', name: 'MacBook Pro 14"', brand: 'Apple', model: 'M4 Pro',
      category: 'computers', purchaseDate: iso(-190), durationMonths: 36,
      retailer: 'iDigital', price: 11200, currency: 'ILS', serial: 'C02XG2JMQ6L4',
      source: 'user_entered', verified: true, notes: '', createdAt: Date.now() - 3000,
      hasReceipt: true, warrantyProvider: '', serviceProvider: '',
    },
    {
      id: 'p3', name: 'Dyson V15 Detect', brand: 'Dyson', model: 'SV47',
      category: 'appliances', purchaseDate: iso(-800), durationMonths: 24,
      retailer: 'Dyson Store', price: 2790, currency: 'ILS', serial: '',
      source: 'user_entered', verified: true, notes: '', createdAt: Date.now() - 2000,
      hasReceipt: false, warrantyProvider: '', serviceProvider: '',
    },
  ];
}

function defaultState() {
  return {
    screen: 'home',
    params: {},
    stack: [],
    products: seedProducts(),
    plan: 'free',
    theme: 'light',
    lang: 'en',
    name: 'Sarah',
    onboarded: false,
    readAlerts: [],
    draft: null,
    sheet: null,
    toast: null,
    coverage: null,
    query: '',
    filter: 'all',
  };
}

let S = defaultState();

function persist() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        products: S.products, plan: S.plan, theme: S.theme, lang: S.lang,
        name: S.name, onboarded: S.onboarded, readAlerts: S.readAlerts,
      }),
    );
  } catch (e) { /* private browsing — the prototype still works, just won't persist */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(S, saved);
  } catch (e) { /* corrupt payload — fall back to the seed */ }
}

/* ------------------------------------------------------------ formatting -- */

function fmtDate(iso, style) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(STRINGS[S.lang].locale, {
      timeZone: 'UTC', dateStyle: style || 'medium',
    }).format(parseDate(iso));
  } catch (e) { return iso; }
}

function fmtMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  try {
    return new Intl.NumberFormat(STRINGS[S.lang].locale, {
      style: 'currency', currency: currency || 'USD', currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch (e) { return amount + ' ' + (currency || ''); }
}

/** Latin identifiers pinned LTR so their digits don't reorder in Hebrew. */
function ltr(v) {
  return S.lang === 'he' ? '⁦' + v + '⁩' : v;
}

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* -------------------------------------------------------------- coverage --
   Simulated. Deterministic keyword routing rather than a model call, but it
   keeps the app's real contract: it never says "covered", and every verdict
   other than insufficient_information cites a clause. */

const CLAUSES = {
  electronics: {
    covered: 'Defects in materials and workmanship of the display panel arising under normal domestic use.',
    section: 'What is covered',
  },
  appliances: {
    covered: 'Mechanical and electrical failure of the motor, pump and drum assembly during the warranty period.',
    section: 'What is covered',
  },
  computers: {
    covered: 'Manufacturing defects affecting the logic board, display assembly and internal storage.',
    section: 'Hardware coverage',
  },
  _default: {
    covered: 'Defects in materials and workmanship arising under normal use during the warranty period.',
    section: 'What is covered',
  },
};

const EXCLUSION_CLAUSE =
  'Damage caused by impact, liquid ingress, misuse, or repair by an unauthorised technician.';

const DAMAGE_WORDS = ['drop', 'dropped', 'fell', 'crack', 'cracked', 'smashed', 'water', 'spill', 'spilled', 'liquid', 'soaked', 'impact', 'נפל', 'שבר', 'נשבר', 'מים', 'נשפך', 'סדק'];
const FAULT_WORDS = ['noise', 'loud', 'not working', "won't", 'wont', 'stopped', 'display', 'screen', 'line', 'lines', 'battery', 'overheat', 'error', 'leak', 'spin', 'fails', 'failing', 'flicker', 'dead', 'רעש', 'לא עובד', 'מסך', 'סוללה', 'תקלה', 'דולף'];
const NEGATORS = ['never', 'not', 'no', 'nothing', "wasn't", 'wasnt', "didn't", 'didnt', "hasn't", 'hasnt', "haven't", 'havent', "isn't", 'isnt', 'without', 'לא', 'מעולם', 'בלי'];

/**
 * Substring matching alone reads "it was never dropped" as damage, which is the
 * opposite of what the user said. Before counting a keyword, look back a few
 * words for a negator and discard the match if one is there.
 */
function mentions(text, words) {
  const tokens = text.toLowerCase().replace(/[.,;:!?()"']/g, ' ').split(/\s+/).filter(Boolean);
  const NEG_WINDOW = 4;

  for (let i = 0; i < tokens.length; i += 1) {
    for (const word of words) {
      const parts = word.split(' ');
      const slice = tokens.slice(i, i + parts.length).join(' ');
      // Prefix match so "cracked" still catches "crack", without matching mid-word.
      const hit = parts.length > 1
        ? slice === word
        : tokens[i] === word || tokens[i].indexOf(word) === 0;
      if (!hit) continue;

      const before = tokens.slice(Math.max(0, i - NEG_WINDOW), i);
      const negated = before.some((tk) => NEGATORS.indexOf(tk) !== -1);
      if (!negated) return true;
    }
  }
  return false;
}

function analyseCoverage(text, category) {
  const clause = CLAUSES[category] || CLAUSES._default;

  if (text.trim().length < 12) {
    return { verdict: 'insufficient_information', confidence: 0.15, clauses: [], exclusions: [] };
  }

  const damage = mentions(text, DAMAGE_WORDS);
  const fault = mentions(text, FAULT_WORDS);

  if (damage) {
    return {
      verdict: 'likely_not_covered', confidence: 0.78,
      why: S.lang === 'he'
        ? 'התיאור מצביע על נזק פיזי או חדירת נוזל, ואלה מופיעים במפורש ברשימת החריגים.'
        : 'What you described points to physical damage or liquid ingress, which the terms list explicitly as an exclusion.',
      clauses: [{ section: S.lang === 'he' ? 'חריגים' : 'Exclusions', text: EXCLUSION_CLAUSE }],
      exclusions: [],
      action: S.lang === 'he'
        ? 'עדיין כדאי לפנות לנותן השירות — חלק מהיצרנים מציעים תיקון בתשלום מופחת.'
        : "It's still worth contacting the service provider — some manufacturers offer a reduced-rate repair.",
    };
  }

  if (fault) {
    return {
      verdict: 'likely_covered', confidence: 0.84,
      why: S.lang === 'he'
        ? 'התקלה שתיארתם תואמת לסעיף הכיסוי לכשל ייצור, ולא לחריג הנזק הפיזי.'
        : 'The fault you described matches the manufacturing-defect clause rather than the physical damage exclusion.',
      clauses: [{ section: clause.section, text: clause.covered }],
      exclusions: [
        S.lang === 'he' ? 'נזק פיזי או חדירת נוזל' : 'Physical or liquid damage',
        S.lang === 'he' ? 'תיקון על ידי טכנאי לא מורשה' : 'Repair by an unauthorised technician',
      ],
      action: S.lang === 'he'
        ? 'פנו לנותן השירות המורשה עם הקבלה והמספר הסידורי.'
        : 'Contact the authorised service centre with your receipt and serial number.',
    };
  }

  return {
    verdict: 'possibly_covered', confidence: 0.48,
    why: S.lang === 'he'
      ? 'התיאור לא מפרט מספיק כדי להתאים אותו לסעיף מסוים. פירוט נוסף ישפר את ההערכה.'
      : "The description doesn't map cleanly onto a specific clause. More detail would sharpen this.",
    clauses: [{ section: clause.section, text: clause.covered }],
    exclusions: [],
    action: S.lang === 'he'
      ? 'תארו מתי זה קורה ומה בדיוק לא עובד, ובדקו שוב.'
      : 'Describe when it happens and exactly what fails, then check again.',
  };
}

/* ------------------------------------------------------------------- nav -- */

function go(screen, params) {
  S.stack.push({ screen: S.screen, params: S.params });
  S.screen = screen;
  S.params = params || {};
  render();
  scrollTop();
}

function replace(screen, params) {
  S.screen = screen;
  S.params = params || {};
  render();
  scrollTop();
}

function back() {
  const prev = S.stack.pop();
  if (prev) { S.screen = prev.screen; S.params = prev.params; }
  else { S.screen = 'home'; S.params = {}; }
  render();
  scrollTop();
}

function tab(screen) {
  S.stack = [];
  S.screen = screen;
  S.params = {};
  render();
  scrollTop();
}

function scrollTop() {
  const b = document.querySelector('.app-body');
  if (b) b.scrollTop = 0;
}

function toast(msg) {
  S.toast = msg;
  render();
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { S.toast = null; render(); }, 2600);
}

/* ---------------------------------------------------------------- icons -- */

const I = {
  home: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4v-5h-6v5H5a1 1 0 01-1-1v-8.5z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="3.5" stroke="currentColor" stroke-width="1.75"/><path d="M8 15.5c1.2-3.4 3.1-5.2 5.6-5.4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M11.6 8.4l2.4 1.6-1.7 2.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9.5a6 6 0 0112 0c0 3.2.7 4.9 1.5 5.9.3.4 0 1.1-.6 1.1H5.1c-.6 0-.9-.7-.6-1.1.8-1 1.5-2.7 1.5-5.9z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M10 19.5a2.2 2.2 0 004 0" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8.5" r="3.75" stroke="currentColor" stroke-width="1.75"/><path d="M4.5 20c.7-3.6 3.8-5.5 7.5-5.5s6.8 1.9 7.5 5.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.75"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" class="dir"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  backArrow: '<svg viewBox="0 0 24 24" fill="none" class="dir"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 8.5h3l1.4-2.2h7.2L17 8.5h3a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.25" stroke="currentColor" stroke-width="1.75"/></svg>',
  barcode: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7V5.5A1.5 1.5 0 015.5 4H7M17 4h1.5A1.5 1.5 0 0120 5.5V7M20 17v1.5a1.5 1.5 0 01-1.5 1.5H17M7 20H5.5A1.5 1.5 0 014 18.5V17" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M8 8.5v7M11 8.5v7M14 8.5v7M16.5 8.5v7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none"><path d="M13.5 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8.5l-5-5z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M13.5 3.5v5h5" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none"><path d="M15.5 5.5l3 3L9 18H6v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.75"/><path d="M12 11v5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="12" cy="8" r=".9" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0111.5 4h1A1.5 1.5 0 0114 5.5V7M7 7l.8 12A1.5 1.5 0 009.3 20.5h5.4A1.5 1.5 0 0016.2 19L17 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function icon(name, cls) {
  return '<span class="ico ' + (cls || '') + '">' + I[name] + '</span>';
}

/* --------------------------------------------------------- illustrations --
   Ported from apps/mobile/src/ui/ProductIllustration.tsx. One 32-unit grid,
   one stroke weight, accent fill only on the "live" part of each object.
   V1 drew the same grey box for a television and a vacuum cleaner, which is
   what made a list of things you own read as a list of database rows. */

const ART = {
  electronics:
    '<rect x="3" y="6" width="26" height="16" rx="2" class="acc"/>' +
    '<rect x="3" y="6" width="26" height="16" rx="2" class="st"/>' +
    '<path d="M12 26h8M16 22v4" class="st" stroke-linecap="round"/>',
  computers:
    '<rect x="5" y="7" width="22" height="14" rx="1.8" class="acc"/>' +
    '<rect x="5" y="7" width="22" height="14" rx="1.8" class="st"/>' +
    '<path d="M2.5 24.5h27a1.5 1.5 0 001.2-2.4L29 21H3l-1.7 1.1a1.5 1.5 0 001.2 2.4z" class="st"/>',
  phones:
    '<rect x="9" y="3" width="14" height="26" rx="3" class="acc"/>' +
    '<rect x="9" y="3" width="14" height="26" rx="3" class="st"/>' +
    '<path d="M14 6h4" class="st" stroke-linecap="round"/>' +
    '<circle cx="16" cy="25.5" r="1.1" class="fillst"/>',
  appliances:
    '<rect x="6" y="3" width="20" height="26" rx="2.5" class="st"/>' +
    '<circle cx="16" cy="19" r="6" class="acc"/>' +
    '<circle cx="16" cy="19" r="6" class="st"/>' +
    '<circle cx="16" cy="19" r="2.4" class="st"/>' +
    '<path d="M10 8h6" class="st" stroke-linecap="round"/>' +
    '<circle cx="22" cy="8" r="1.2" class="st"/>',
  vacuum:
    '<path d="M20 4l-3 14" class="st" stroke-linecap="round"/>' +
    '<rect x="13" y="16" width="11" height="9" rx="2.5" class="acc" transform="rotate(-12 18 20)"/>' +
    '<rect x="13" y="16" width="11" height="9" rx="2.5" class="st" transform="rotate(-12 18 20)"/>' +
    '<path d="M11 24l-4 4" class="st" stroke-linecap="round"/>' +
    '<path d="M5 27.5h5" class="st" stroke-linecap="round"/>' +
    '<circle cx="20.5" cy="4" r="1.8" class="st"/>',
  audio:
    '<path d="M6 19v-3a10 10 0 0120 0v3" class="st" stroke-linecap="round"/>' +
    '<rect x="3" y="18" width="6" height="10" rx="3" class="acc"/>' +
    '<rect x="3" y="18" width="6" height="10" rx="3" class="st"/>' +
    '<rect x="23" y="18" width="6" height="10" rx="3" class="acc"/>' +
    '<rect x="23" y="18" width="6" height="10" rx="3" class="st"/>',
  watches:
    '<rect x="10" y="9" width="12" height="14" rx="3.4" class="acc"/>' +
    '<rect x="10" y="9" width="12" height="14" rx="3.4" class="st"/>' +
    '<path d="M13 9V5.5A1.5 1.5 0 0114.5 4h3A1.5 1.5 0 0119 5.5V9M13 23v3.5A1.5 1.5 0 0014.5 28h3a1.5 1.5 0 001.5-1.5V23" class="st"/>' +
    '<path d="M16 13v3l2 1.4" class="st" stroke-linecap="round"/>',
  furniture:
    '<path d="M5 15v-3a2.5 2.5 0 015 0v3" class="st"/>' +
    '<path d="M22 15v-3a2.5 2.5 0 015 0v3" class="st"/>' +
    '<rect x="4" y="14" width="24" height="9" rx="2.5" class="acc"/>' +
    '<rect x="4" y="14" width="24" height="9" rx="2.5" class="st"/>' +
    '<path d="M7 23v3M25 23v3" class="st" stroke-linecap="round"/>',
  tools:
    '<path d="M20.5 4a6 6 0 00-5.2 9L4.6 23.7a2.2 2.2 0 103.1 3.1L18.4 16a6 6 0 106.4-9.6l-3.2 3.2-2.9-.6-.6-2.9 3.2-3.2A6 6 0 0020.5 4z" class="acc"/>' +
    '<path d="M20.5 4a6 6 0 00-5.2 9L4.6 23.7a2.2 2.2 0 103.1 3.1L18.4 16a6 6 0 106.4-9.6l-3.2 3.2-2.9-.6-.6-2.9 3.2-3.2A6 6 0 0020.5 4z" class="st"/>',
  automotive:
    '<path d="M4 20v-3.2l2.4-5.4A2.4 2.4 0 018.6 10h14.8a2.4 2.4 0 012.2 1.4L28 16.8V20H4z" class="acc"/>' +
    '<path d="M4 20v-3.2l2.4-5.4A2.4 2.4 0 018.6 10h14.8a2.4 2.4 0 012.2 1.4L28 16.8V20H4z" class="st"/>' +
    '<circle cx="9.5" cy="20.5" r="2.6" class="st"/>' +
    '<circle cx="22.5" cy="20.5" r="2.6" class="st"/>',
  baby:
    '<path d="M6 20a10 10 0 0120 0H6z" class="acc"/>' +
    '<path d="M6 20a10 10 0 0120 0H6z" class="st"/>' +
    '<path d="M16 10v10" class="st" stroke-linecap="round"/>' +
    '<circle cx="9" cy="25" r="2.2" class="st"/>' +
    '<circle cx="23" cy="25" r="2.2" class="st"/>',
  jewelry:
    '<path d="M10 5h12l5 7-11 15L5 12z" class="acc"/>' +
    '<path d="M10 5h12l5 7-11 15L5 12z" class="st"/>' +
    '<path d="M5 12h22M10 5l6 7 6-7M16 12v15" class="st"/>',
  other:
    '<path d="M16 4l11 5.5v13L16 28 5 22.5v-13z" class="acc"/>' +
    '<path d="M16 4l11 5.5v13L16 28 5 22.5v-13z" class="st"/>' +
    '<path d="M5 9.5L16 15l11-5.5M16 15v13" class="st"/>',
};

/** Refines the category by product name: a Dyson V15 is not a washing machine. */
function artSlug(category, hint) {
  const s = String(hint || '').toLowerCase();
  if (/vacuum|hoover|dyson|v15|v11|stick/.test(s)) return 'vacuum';
  if (/headphone|earbud|airpod|wh-1000|buds|speaker|soundbar|sonos/.test(s)) return 'audio';
  if (/washer|washing|dryer|dishwasher|fridge|refrigerator|freezer|oven/.test(s)) return 'appliances';
  if (/macbook|laptop|notebook|thinkpad|surface|imac/.test(s)) return 'computers';
  if (/iphone|galaxy|pixel|phone|xiaomi/.test(s)) return 'phones';
  if (/\btv\b|oled|qled|television|monitor|display|s95d|qn90/.test(s)) return 'electronics';
  if (/watch|garmin|fitbit/.test(s)) return 'watches';
  return ART[category] ? category : 'other';
}

/** The product's picture. In the real app a user photo wins; here it is always art. */
function productArt(p, size) {
  const slug = artSlug(p.category, p.name);
  return '<span class="art" style="--art:' + (size || 60) + 'px" aria-hidden="true">' +
    '<svg viewBox="0 0 32 32" fill="none">' + ART[slug] + '</svg></span>';
}

/* ------------------------------------------------------------ protection --
   Ported verbatim from apps/mobile/src/domain/protection.ts. Deterministic:
   no model involvement, every point traceable to a named factor, which is the
   only reason the score can be shown as prominently as it is. */

const FACTORS = [
  { key: 'purchase_date', weight: 20 },
  { key: 'warranty_end', weight: 20 },
  { key: 'proof_of_purchase', weight: 18 },
  { key: 'warranty_provider', weight: 12 },
  { key: 'warranty_terms', weight: 10 },
  { key: 'serial_number', weight: 8 },
  { key: 'service_provider', weight: 7 },
  { key: 'model', weight: 5 },
];

function factorSatisfied(key, p) {
  switch (key) {
    case 'purchase_date': return !!p.purchaseDate;
    case 'warranty_end': return !!p.purchaseDate && !!p.durationMonths;
    case 'proof_of_purchase': return !!p.hasReceipt;
    case 'warranty_provider': return !!p.warrantyProvider;
    case 'warranty_terms': return p.source === 'manufacturer';
    case 'serial_number': return !!(p.serial && p.serial.trim());
    case 'service_provider': return !!p.serviceProvider;
    case 'model': return !!(p.model && p.model.trim());
    default: return false;
  }
}

function completeness(p) {
  let earned = 0;
  const gaps = [], satisfied = [];
  FACTORS.forEach((f) => {
    if (factorSatisfied(f.key, p)) { earned += f.weight; satisfied.push(f.key); }
    else gaps.push(f);
  });
  gaps.sort((a, b) => b.weight - a.weight);
  return { score: Math.round(earned), gaps: gaps, satisfied: satisfied };
}

/** An expired product still counts — its records have value — but weighs less. */
function statusWeight(status) {
  if (status === 'active' || status === 'ending_soon') return 1;
  if (status === 'expired') return 0.25;
  return 0.5;
}

function portfolioProtection() {
  if (S.products.length === 0) return { score: null, band: 'empty', count: 0 };
  const now = today();
  let sum = 0, weight = 0;
  S.products.forEach((p) => {
    const w = statusWeight(snapshot(p, now).status);
    sum += completeness(p).score * w;
    weight += w;
  });
  const score = weight === 0 ? 0 : Math.round(sum / weight);
  return {
    score: score,
    band: score >= 85 ? 'strong' : score >= 60 ? 'fair' : 'needs_attention',
    count: S.products.length,
  };
}

function urgency(status, days) {
  if (status === 'expired') return 0.2;
  if (status === 'unknown') return 1.2;
  if (days === null) return 1;
  if (days <= 30) return 2.5;
  if (days <= 90) return 1.6;
  return 1;
}

/** Gap × urgency, so a missing receipt on a warranty ending in 12 days wins. */
function suggestedActions(limit) {
  const now = today();
  const out = [];
  S.products.forEach((p) => {
    const s = snapshot(p, now);
    completeness(p).gaps.forEach((g) => {
      out.push({
        product: p, key: g.key, weight: g.weight,
        priority: g.weight * urgency(s.status, s.daysRemaining),
      });
    });
  });
  out.sort((a, b) => b.priority - a.priority);
  return out.slice(0, limit || 4);
}

/** The score ring. An SVG arc starting at 12 o'clock, like every progress ring. */
function protectionRing(score, band, size) {
  const d = size || 116, stroke = 10, r = (d - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return '<span class="ring" style="--d:' + d + 'px">' +
    '<svg viewBox="0 0 ' + d + ' ' + d + '" aria-hidden="true">' +
      '<circle cx="' + d / 2 + '" cy="' + d / 2 + '" r="' + r + '" class="ring-track" stroke-width="' + stroke + '"/>' +
      (score === null ? '' :
        '<circle cx="' + d / 2 + '" cy="' + d / 2 + '" r="' + r + '" class="ring-fill' + (band === 'needs_attention' ? ' warn-ring' : '') +
        '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' +
        (c * pct).toFixed(2) + ' ' + c.toFixed(2) + '"/>') +
    '</svg>' +
    '<span class="ring-label"><span class="num">' + (score === null ? '—' : score + '%') + '</span>' +
    '<span class="cap ter">' + t('claimReady') + '</span></span></span>';
}

/* -------------------------------------------------------------- helpers -- */

function statusMeta(status) {
  if (status === 'active') return { label: t('active'), cls: 'active', dot: 'dot' };
  if (status === 'ending_soon') return { label: t('endingSoon'), cls: 'ending', dot: 'dot ring' };
  if (status === 'expired') return { label: t('expired'), cls: 'expired', dot: 'dot sq' };
  return { label: t('unknownStatus'), cls: 'unknown', dot: 'dot dash' };
}

function badge(status, small) {
  const m = statusMeta(status);
  return '<span class="badge ' + m.cls + (small ? ' sm' : '') +
    '"><i class="' + m.dot + '"></i>' + esc(m.label) + '</span>';
}

function remainingText(snap) {
  if (snap.daysRemaining === null) return '';
  if (snap.daysRemaining < 0) return tn('expiredAgo', Math.abs(snap.daysRemaining));
  if (snap.daysRemaining > 365) return t('endsOn', { d: fmtDate(snap.end) });
  return tn('daysRemaining', snap.daysRemaining);
}

function sortedProducts() {
  const now = today();
  const rank = { ending_soon: 0, active: 1, unknown: 2, expired: 3 };
  return S.products.slice().sort((a, b) => {
    const sa = snapshot(a, now), sb = snapshot(b, now);
    const r = rank[sa.status] - rank[sb.status];
    if (r !== 0) return r;
    if (sa.daysRemaining === null) return sb.daysRemaining === null ? 0 : 1;
    if (sb.daysRemaining === null) return -1;
    return sa.daysRemaining - sb.daysRemaining;
  });
}

function summary() {
  const now = today();
  const c = { active: 0, ending_soon: 0, expired: 0, unknown: 0 };
  S.products.forEach((p) => { c[snapshot(p, now).status] += 1; });
  return c;
}

function alertsList() {
  const now = today();
  return S.products
    .map((p) => ({ p: p, s: snapshot(p, now) }))
    .filter((x) => x.s.status === 'ending_soon' || x.s.status === 'expired')
    .sort((a, b) => (a.s.daysRemaining || 0) - (b.s.daysRemaining || 0));
}

/* -------------------------------------------------------------- screens -- */

function viewHome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'greetMorning' : hour < 18 ? 'greetAfternoon' : 'greetEvening';
  const limit = PLANS[S.plan].limit;

  if (S.products.length === 0) {
    return section([
      '<h2 class="h2" dir="auto">' + t(greet) + ', ' + esc(S.name) + '</h2>',
      emptyState(t('emptyTitle'), t('emptyBody'), t('emptyCta'), "go('addMethod')"),
    ].join(''));
  }

  const pf = portfolioProtection();
  const soonest = alertsList().find((x) => x.s.status === 'ending_soon');
  const actions = suggestedActions(4);
  const recent = S.products.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const bandKey = { strong: 'bandStrong', fair: 'bandFair', needs_attention: 'bandNeedsAttention', empty: 'bandEmpty' }[pf.band];

  return section([
    '<h2 class="h2" dir="auto">' + t(greet) + ', ' + esc(S.name) + '</h2>',

    // One number with a sentence about it, in place of V1's three counter tiles.
    '<div class="hero row g16">' + protectionRing(pf.score, pf.band) +
      '<div class="stack g4 grow">' +
        '<p class="meta ter">' + t('protectionTitle') + '</p>' +
        '<p class="h3">' + t(bandKey) + '</p>' +
        '<p class="cap sec">' + tn('tracked', pf.count) + '</p>' +
      '</div>' +
    '</div>',

    soonest
      ? '<div class="panel brand stack g12">' +
        '<span class="row g8"><i class="dot" style="background:var(--st-end-fg)"></i>' +
        '<span class="meta onb dim">' + t('attention') + '</span></span>' +
        '<p class="h3 onb" dir="auto">' + esc(tn('endsIn', Math.max(0, soonest.s.daysRemaining), { name: soonest.p.name })) + '</p>' +
        '<p class="sm onb dim">' + t('endsOn', { d: fmtDate(soonest.s.end, 'long') }) + '</p>' +
        '<button class="linkrow" data-act="go" data-screen="product" data-id="' + soonest.p.id + '">' +
        '<span class="sms onb">' + t('reviewWarranty') + '</span>' + icon('chevron', 'onb sm-ico') + '</button>' +
        '</div>'
      : '',

    actions.length
      ? '<div class="stack g8">' +
        '<div class="stack tiny-gap"><p class="h3">' + t('recommendedActions') + '</p>' +
        '<p class="cap ter">' + t('recommendedSub') + '</p></div>' +
        '<div class="stack g4">' + actions.map(actionRow).join('') + '</div>' +
        '</div>'
      : '<div class="allgood row g12">' + icon('check', 'sm-ico') +
        '<span class="sms">' + t('allOnFile') + '</span></div>',

    '<div class="stack g8">',
    '<div class="row between"><p class="h3">' + t('yourProducts') + '</p>',
    '<button class="link" data-act="tab" data-screen="products">' + t('seeAll') + '</button></div>',
    '<div class="stack g4">' + recent.map(productCard).join('') + '</div>',
    '</div>',

    '<div class="stack g8">',
    '<button class="btn primary" data-act="go" data-screen="addMethod">' + t('addProduct') + '</button>',
    limit !== null
      ? '<p class="cap ter center">' + t('slotsUsed', { used: S.products.length, limit: limit }) + '</p>'
      : '',
    '</div>',
  ].join(''));
}

/** Factor copy. Keys look like `purchase_date`, so the lookup is pf/pa + Capitalised. */
function factorLabel(key) { return t('pf' + key.charAt(0).toUpperCase() + key.slice(1)); }
function actionLabel(key) { return t('pa' + key.charAt(0).toUpperCase() + key.slice(1)); }

/** One recommended action: what's missing, which product, and what it's worth. */
function actionRow(a) {
  return '<button class="act row g12 pressable" data-act="go" data-screen="product" data-id="' + a.product.id + '">' +
    productArt(a.product, 40) +
    '<span class="stack tiny-gap grow start">' +
      '<span class="sms">' + esc(actionLabel(a.key)) + '</span>' +
      '<span class="cap ter" dir="auto">' + esc(a.product.name) + '</span>' +
    '</span>' +
    '<span class="cap worth">' + ltr('+' + a.weight + '%') + '</span>' +
  '</button>';
}

function productCard(p) {
  const s = snapshot(p, today());
  const rem = remainingText(s);
  const m = statusMeta(s.status);
  const label = { active: 'protectedShort', ending_soon: 'endingShort', expired: 'expiredShort' }[s.status] || 'unknownShort';

  // No border: the card separates from the warm canvas by being brighter than
  // it. Status is a dot and a word rather than a filled pill — a list of eight
  // pills is louder than the products themselves.
  return '<button class="pcard row g16 pressable" data-act="go" data-screen="product" data-id="' + p.id + '">' +
    productArt(p, 60) +
    '<span class="stack tiny-gap grow start">' +
      '<span class="bds" dir="auto">' + esc(p.name) + '</span>' +
      (p.brand ? '<span class="cap ter" dir="auto">' + esc(p.brand) + '</span>' : '') +
      '<span class="row g8 wrap statusline ' + m.cls + '">' +
        '<i class="' + m.dot + '"></i><span class="sms">' + esc(t(label)) + '</span>' +
        (rem ? '<span class="cap ter">·</span><span class="cap sec">' + esc(rem) + '</span>' : '') +
      '</span>' +
    '</span>' +
  '</button>';
}

function viewProducts() {
  const q = S.query.trim().toLowerCase();
  const c = summary();
  let list = sortedProducts();

  if (q) {
    list = list.filter((p) =>
      (p.name + ' ' + (p.brand || '') + ' ' + (p.model || '') + ' ' + (p.serial || ''))
        .toLowerCase().indexOf(q) !== -1);
  }
  if (S.filter !== 'all') {
    const now = today();
    list = list.filter((p) => snapshot(p, now).status === S.filter);
  }

  const filtered = q.length > 0 || S.filter !== 'all';

  return section([
    '<h1 class="h1">' + t('myProducts') + '</h1>',
    '<div class="field search">' + icon('search', 'ter') +
      '<input id="q" type="search" placeholder="' + esc(t('searchPlaceholder')) +
      '" value="' + esc(S.query) + '" aria-label="' + esc(t('searchPlaceholder')) + '">' +
      (S.query ? '<button class="iconbtn" data-act="clearq" aria-label="' + esc(t('clear')) + '">' + icon('close', 'ter') + '</button>' : '') +
    '</div>',

    '<div class="seg" role="tablist">',
    segBtn('all', t('all'), S.products.length),
    segBtn('active', t('active'), c.active),
    segBtn('ending_soon', t('endingSoon'), c.ending_soon),
    segBtn('expired', t('expired'), c.expired),
    '</div>',

    list.length
      ? '<div class="stack g4">' + list.map(productCard).join('') + '</div>'
      : filtered
        ? emptyState(t('noMatchTitle'), t('noMatchBody'), t('clear'), "resetFilters()")
        : emptyState(t('emptyTitle'), t('emptyBody'), t('emptyCta'), "go('addMethod')"),
  ].join(''));
}

function segBtn(value, label, count) {
  return '<button class="segbtn' + (S.filter === value ? ' on' : '') +
    '" role="tab" aria-selected="' + (S.filter === value) + '" data-act="filter" data-value="' + value + '">' +
    esc(label) + ' <em>' + count + '</em></button>';
}

function viewProduct() {
  const p = S.products.find((x) => x.id === S.params.id);
  if (!p) return section('<p class="sm sec">Not found</p>');
  const s = snapshot(p, today());
  const claimable = s.status === 'active' || s.status === 'ending_soon';
  const rem = remainingText(s);

  return section([
    '<div class="row between navrow">',
    '<button class="iconbtn" data-act="back" aria-label="' + esc(t('back')) + '">' + icon('backArrow') + '</button>',
    '<button class="link" data-act="go" data-screen="edit" data-id="' + p.id + '">' + t('edit') + '</button>',
    '</div>',

    // The product, not a record of it. V1 opened with a dark card of four text
    // lines and no clue what the thing actually was.
    '<div class="phero stack g16">' + productArt(p, 120) +
      '<div class="stack g4">' +
        '<p class="h1 center" dir="auto">' + esc(p.name) + '</p>' +
        (p.brand || p.model
          ? '<p class="sm ter center" dir="auto">' + esc(p.brand || '') + (p.model ? ' · ' + esc(ltr(p.model)) : '') + '</p>'
          : '') +
      '</div>' +
      '<div class="row g8 wrap center-row">' + badge(s.status) +
        (rem ? '<span class="sm sec">' + esc(rem) + '</span>' : '') + '</div>' +
    '</div>',

    !p.verified
      ? '<div class="notice warn">' + icon('info') + '<span class="sm">' +
        (S.lang === 'he' ? 'אנא בדקו שזה נכון' : 'Please check this is right') + '</span></div>'
      : '',

    s.start && s.end
      ? '<div class="panel stack g8">' +
        '<p class="meta ter">' + t('timeline') + '</p>' +
        '<div class="track"><i class="' + statusMeta(s.status).cls + '" style="width:' +
          Math.round((s.progress || 0) * 100) + '%"></i></div>' +
        '<div class="row between">' +
          '<div class="stack tiny-gap"><p class="cap ter">' + t('purchased') + '</p>' +
            '<p class="sms">' + fmtDate(s.start, 'short') + '</p></div>' +
          '<div class="stack tiny-gap end"><p class="cap ter">' + t('warrantyEnds') + '</p>' +
            '<p class="sms">' + fmtDate(s.end, 'short') + '</p></div>' +
        '</div></div>'
      : '',

    '<div class="row g6 prov">' + icon('info', 'ter sm-ico') +
      '<span class="cap ter">' + (p.source === 'manufacturer' ? t('sourceMfr') : t('sourceUser')) + '</span>' +
      '<span class="cap ter">·</span>' +
      '<span class="cap ' + (p.verified ? 'ok' : 'warn') + '">' +
        (p.verified ? t('confHigh') : t('confLow')) + '</span></div>',

    claimReadiness(p),

    claimable
      ? '<button class="btn primary" data-act="coverage" data-id="' + p.id + '">' + t('reportProblem') + '</button>'
      : '',

    '<div class="stack g8"><p class="meta ter">' + t('purchase') + '</p><div class="group">' +
      row(t('purchased'), fmtDate(p.purchaseDate, 'long')) +
      (p.retailer ? row(t('boughtAt'), '<span dir="auto">' + esc(p.retailer) + '</span>') : '') +
      (p.price ? row(t('price'), fmtMoney(p.price, p.currency)) : '') +
    '</div></div>',

    (p.model || p.serial)
      ? '<div class="stack g8"><p class="meta ter">' + t('details') + '</p><div class="group">' +
        (p.model ? row(t('model'), esc(ltr(p.model))) : '') +
        (p.serial ? row(t('serial'), esc(ltr(p.serial))) : '') +
        '</div></div>'
      : '',

    p.notes ? '<div class="card stack g6"><p class="meta ter">' + t('notes') + '</p><p class="sm" dir="auto">' + esc(p.notes) + '</p></div>' : '',

    '<button class="btn danger" data-act="confirmDelete" data-id="' + p.id + '">' +
      icon('trash', 'sm-ico') + t('del') + '</button>',
  ].join(''));
}

/**
 * Per-product claim readiness: the same score as Home, broken into the facts it
 * is made of. Every gap is a row you can act on; the satisfied ones are listed
 * quietly, because showing only what's missing reads as nagging.
 */
function claimReadiness(p) {
  const c = completeness(p);
  const tone = c.score >= 85 ? 'active' : c.score >= 60 ? 'ending' : 'expired';

  return '<div class="panel stack g16">' +
    '<div class="stack g8">' +
      '<div class="row between g8"><p class="h3">' + t('claimReadiness') + '</p>' +
      '<p class="cap ter">' + (c.gaps.length ? tn('gapsLeft', c.gaps.length) : t('allOnFile')) + '</p></div>' +
      '<div class="row between g8"><div class="track grow"><i class="' + tone + '" style="width:' + c.score + '%"></i></div>' +
      '<span class="meta ' + tone + '-text">' + ltr(c.score + '%') + '</span></div>' +
    '</div>' +
    (c.gaps.length
      ? '<div class="stack g4">' + c.gaps.map((g) =>
          '<div class="gap row g12"><i class="hollow"></i>' +
          '<span class="sm grow start">' + esc(actionLabel(g.key)) + '</span>' +
          '<span class="cap worth">' + ltr('+' + g.weight + '%') + '</span>' +
          icon('chevron', 'ter sm-ico') + '</div>').join('') + '</div>'
      : '') +
    (c.satisfied.length
      ? '<div class="row wrap g8">' + c.satisfied.map((k) =>
          '<span class="tick row g4">' + icon('check', 'sm-ico') + esc(factorLabel(k)) + '</span>').join('') + '</div>'
      : '') +
  '</div>';
}

function row(label, value) {
  return '<div class="lrow"><span class="bd grow">' + esc(label) + '</span>' +
    '<span class="sm ter">' + value + '</span></div>';
}

function viewAddMethod() {
  const locked = !PLANS[S.plan].smartScan;
  const methods = [
    { k: 'scan', icon: 'camera', title: t('mScan'), body: t('mScanB'), locked: locked, wired: false },
    { k: 'barcode', icon: 'barcode', title: t('mBarcode'), body: t('mBarcodeB'), locked: locked, wired: false },
    { k: 'photo', icon: 'doc', title: t('mPhoto'), body: t('mPhotoB'), locked: false, wired: false },
    { k: 'manual', icon: 'pencil', title: t('mManual'), body: t('mManualB'), locked: false, wired: true },
  ];

  return section([
    '<div class="row end navrow"><button class="iconbtn" data-act="back" aria-label="' + esc(t('close')) + '">' + icon('close') + '</button></div>',
    '<div class="stack g4"><h1 class="h1">' + t('addTitle') + '</h1>',
    '<p class="bd sec">' + t('addSubtitle') + '</p></div>',
    // V1 gave all four methods the same bordered box, which made the slowest one
    // (typing it all in) look exactly as attractive as the fastest.
    '<button class="mhero stack g12 pressable" data-act="method" data-method="' + methods[0].k +
      '" data-wired="' + methods[0].wired + '">' +
      '<span class="mhero-ico">' + icon(methods[0].icon) + '</span>' +
      '<span class="stack g4 start">' +
        '<span class="row g8"><span class="h3 onb">' + esc(methods[0].title) + '</span>' +
          (methods[0].locked ? '<span class="chip">Plus</span>' : '') + '</span>' +
        '<span class="sm onb dim">' + esc(methods[0].body) + '</span>' +
      '</span>' +
    '</button>',

    '<div class="group">' + methods.slice(1).map((m) =>
      '<button class="lrow pressable" data-act="method" data-method="' + m.k + '" data-wired="' + m.wired + '">' +
        icon(m.icon, 'ter') +
        '<span class="stack tiny-gap grow start">' +
          '<span class="row g8"><span class="bds">' + esc(m.title) + '</span>' +
            (m.locked ? '<span class="chip">Plus</span>' : '') + '</span>' +
          '<span class="cap ter">' + esc(m.body) + '</span>' +
        '</span>' + icon('chevron', 'ter') +
      '</button>').join('') + '</div>',
  ].join(''));
}

const DURATIONS = [12, 24, 36, 60];

function viewForm() {
  const editing = S.screen === 'edit';
  const existing = editing ? S.products.find((x) => x.id === S.params.id) : null;
  const d = S.draft || (existing
    ? Object.assign({}, existing)
    : { name: '', category: '', brand: '', model: '', purchaseDate: '', retailer: '', price: '', durationMonths: null, serial: '', notes: '' });
  S.draft = d;

  const derivedEnd = d.purchaseDate && isCalendarDate(d.purchaseDate) && d.durationMonths
    ? addMonths(d.purchaseDate, d.durationMonths) : null;
  const err = S.draft._errors || {};

  return section([
    '<div class="row navrow"><button class="iconbtn" data-act="back" aria-label="' + esc(t('back')) + '">' + icon('backArrow') + '</button></div>',
    '<h1 class="h1">' + (editing ? t('edit') : t('addTitle')) + '</h1>',

    '<div class="stack g8"><p class="meta ter">' + t('basics') + '</p>',
    field('name', t('fName'), d.name, { required: true, placeholder: t('fNamePh'), error: err.name }),
    picker('category', t('fCategory'), d.category ? catLabel(d.category) : '', { required: true, error: err.category }),
    field('brand', t('fBrand'), d.brand, {}),
    field('model', t('fModel'), d.model, {}),
    '</div>',

    '<div class="stack g8"><p class="meta ter">' + t('purchase') + '</p>',
    field('purchaseDate', t('fPurchaseDate'), d.purchaseDate, {
      required: true, type: 'date', error: err.purchaseDate,
      hint: d.purchaseDate && isCalendarDate(d.purchaseDate) ? fmtDate(d.purchaseDate, 'long') : '',
    }),
    field('retailer', t('fRetailer'), d.retailer, {}),
    field('price', t('fPrice'), d.price, { type: 'number' }),
    '</div>',

    '<div class="stack g8"><p class="meta ter">' + t('warrantySec') + '</p>',
    '<p class="sms sec">' + t('fWarranty') + '</p>',
    '<div class="chips">' + DURATIONS.map((m) =>
      '<button class="dchip' + (d.durationMonths === m ? ' on' : '') +
      '" data-act="duration" data-months="' + m + '">' + tn('months', m) + '</button>').join('') + '</div>',
    derivedEnd
      ? '<p class="cap ter">' + t('warrantyEnds') + ': ' + fmtDate(derivedEnd, 'long') + '</p>'
      : '',
    '</div>',

    '<div class="stack g8"><p class="meta ter">' + t('extras') + '</p>',
    field('serial', t('fSerial'), d.serial, {}),
    field('notes', t('fNotes'), d.notes, { multiline: true }),
    '</div>',

    '<button class="btn primary sticky-save" data-act="save">' + t('saveProduct') + '</button>',
  ].join(''));
}

function field(name, label, value, opts) {
  opts = opts || {};
  const id = 'f_' + name;
  return '<label class="fieldwrap" for="' + id + '">' +
    '<span class="row g6"><span class="sms sec">' + esc(label) + '</span>' +
      (opts.required ? '' : '<span class="cap ter">' + t('optional') + '</span>') + '</span>' +
    (opts.multiline
      ? '<textarea id="' + id + '" class="input area" data-field="' + name + '" rows="3">' + esc(value) + '</textarea>'
      : '<input id="' + id + '" class="input' + (opts.error ? ' bad' : '') + '" data-field="' + name +
        '" type="' + (opts.type === 'number' ? 'number' : 'text') +
        '" inputmode="' + (opts.type === 'number' ? 'decimal' : opts.type === 'date' ? 'numeric' : 'text') + '"' +
        ' placeholder="' + esc(opts.placeholder || (opts.type === 'date' ? 'YYYY-MM-DD' : '')) + '"' +
        ' value="' + esc(value) + '">') +
    (opts.error ? '<span class="cap bad-text">' + esc(opts.error) + '</span>'
      : opts.hint ? '<span class="cap ter">' + esc(opts.hint) + '</span>' : '') +
    '</label>';
}

function picker(name, label, value, opts) {
  opts = opts || {};
  return '<div class="fieldwrap">' +
    '<span class="row g6"><span class="sms sec">' + esc(label) + '</span>' +
      (opts.required ? '' : '<span class="cap ter">' + t('optional') + '</span>') + '</span>' +
    '<button class="input pickbtn' + (opts.error ? ' bad' : '') + '" data-act="pickCategory">' +
      '<span class="' + (value ? '' : 'ter') + '">' + esc(value || t('notSet')) + '</span>' +
      icon('chevron', 'ter') + '</button>' +
    (opts.error ? '<span class="cap bad-text">' + esc(opts.error) + '</span>' : '') +
    '</div>';
}

function viewCoverage() {
  const p = S.products.find((x) => x.id === S.params.id);
  if (!p) return section('<p class="sm sec">Not found</p>');
  const c = S.coverage;

  if (c && c.state === 'analysing') {
    return section([
      '<div class="row end navrow"><button class="iconbtn" data-act="back">' + icon('close') + '</button></div>',
      '<div class="centered">',
      '<p class="h2 center">' + t('analysing') + '</p>',
      '<div class="stack g12 full">' +
        '<div class="skel"></div><div class="skel w80"></div><div class="skel w60"></div></div>',
      '</div>',
    ].join(''));
  }

  if (c && c.state === 'done') {
    const r = c.result;
    const vLabel = { likely_covered: t('vLikely'), possibly_covered: t('vPossibly'),
      likely_not_covered: t('vNot'), insufficient_information: t('vInsufficient') }[r.verdict];
    const tone = { likely_covered: 'ok', possibly_covered: 'warn',
      likely_not_covered: 'bad', insufficient_information: 'info' }[r.verdict];

    return section([
      '<div class="row end navrow"><button class="iconbtn" data-act="back">' + icon('close') + '</button></div>',
      '<div class="card verdict ' + tone + ' stack g8">',
      '<p class="meta">' + t('coverage') + '</p>',
      '<p class="h2">' + esc(vLabel) + '</p>',
      r.why ? '<p class="bd body-on-tint">' + esc(r.why) + '</p>' : '',
      '<p class="cap ter">' + (r.confidence >= 0.75 ? t('confHigh') : t('confLow')) + '</p>',
      '</div>',

      r.clauses.length
        ? '<div class="stack g8"><p class="meta ter">' + t('relevantClauses') + '</p>' +
          r.clauses.map((cl) =>
            '<div class="card subtle stack tiny-gap"><p class="meta ter">' + esc(cl.section) + '</p>' +
            '<p class="sm quote">' + esc(cl.text) + '</p></div>').join('') + '</div>'
        : '',

      r.exclusions && r.exclusions.length
        ? '<div class="stack g6"><p class="meta ter">' + t('watchOut') + '</p>' +
          r.exclusions.map((e) => '<p class="sm sec">• ' + esc(e) + '</p>').join('') + '</div>'
        : '',

      r.action ? '<div class="stack g6"><p class="meta ter">' + t('nextStep') + '</p>' +
        '<p class="sm sec">' + esc(r.action) + '</p></div>' : '',

      '<p class="cap ter">' + t('disclaimer') + '</p>',
      '<button class="btn secondary" data-act="coverageReset" data-id="' + p.id + '">' + t('checkAnother') + '</button>',
    ].join(''));
  }

  const desc = (c && c.text) || '';
  return section([
    '<div class="row end navrow"><button class="iconbtn" data-act="back">' + icon('close') + '</button></div>',
    '<div class="stack g4"><h1 class="h1">' + t('describeTitle') + '</h1>',
    '<p class="sm sec" dir="auto">' + esc(p.name) + '</p></div>',
    '<label class="fieldwrap"><span class="sms sec">' + t('describeBody') + '</span>' +
      '<textarea id="cov" class="input area" rows="4" placeholder="' + esc(t('describePh')) + '">' + esc(desc) + '</textarea></label>',
    !PLANS[S.plan].aiCoverage
      ? '<div class="notice"><span class="sm">' + t('coverageLocked') + '</span></div>' : '',
    '<button class="btn primary" data-act="runCoverage" data-id="' + p.id + '">' +
      (PLANS[S.plan].aiCoverage ? t('analyse') : t('upgrade')) + '</button>',
  ].join(''));
}

function viewAlerts() {
  const list = alertsList();
  return section([
    '<div class="row between"><h1 class="h1">' + t('alerts') + '</h1>' +
      (list.length ? '<button class="link" data-act="readAll">' + t('markAllRead') + '</button>' : '') + '</div>',
    list.length
      ? '<div class="stack g4">' + list.map((x) => {
          const unread = S.readAlerts.indexOf(x.p.id) === -1;
          const days = Math.max(0, x.s.daysRemaining || 0);
          return '<button class="card tight row g12 top pressable" data-act="go" data-screen="product" data-id="' + x.p.id + '">' +
            '<span class="unread' + (unread ? ' on' : '') + '"></span>' +
            '<span class="stack g4 grow start">' +
              '<span class="' + (unread ? 'bds' : 'bd') + '" dir="auto">' + esc(t('alertTitle', { name: x.p.name })) + '</span>' +
              '<span class="sm sec">' + esc(tn('alertBody', days)) + '</span>' +
              '<span class="cap ter">' + fmtDate(x.s.end, 'long') + '</span>' +
            '</span></button>';
        }).join('') + '</div>'
      : emptyState(t('alertsEmptyT'), t('alertsEmptyB')),
  ].join(''));
}

function viewProfile() {
  const limit = PLANS[S.plan].limit;
  const over = limit !== null && S.products.length > limit;
  const planLabel = S.plan.charAt(0).toUpperCase() + S.plan.slice(1);

  return section([
    '<div class="row g16">' +
      '<span class="mono-av">' + esc(monogram(S.name)) + '</span>' +
      '<span class="stack tiny-gap grow start">' +
        '<span class="h2" dir="auto">' + esc(S.name) + '</span>' +
        '<span class="sm ter">sarah@example.com</span>' +
      '</span>' +
    '</div>',

    '<button class="panel brand stack g4 pressable full-w start" data-act="go" data-screen="plans">',
    '<span class="meta onb dim">' + t('subscription') + '</span>',
    '<span class="h2 onb">MY Warranty ' + planLabel + '</span>',
    '<span class="cap onb dim">' + (limit === null
      ? (S.lang === 'he' ? 'מוצרים ללא הגבלה' : 'Unlimited products')
      : t('slotsUsed', { used: S.products.length, limit: limit })) + '</span>',
    '</button>',

    over ? '<div class="notice"><span class="sm">' + t('downgradeNote', { n: S.products.length }) + '</span></div>' : '',

    '<div class="stack g8"><p class="meta ter">' + t('preferences') + '</p><div class="group">' +
      '<div class="lrow"><span class="bd grow">' + t('appearance') + '</span>' +
        '<span class="mini-seg">' +
          '<button class="' + (S.theme === 'light' ? 'on' : '') + '" data-act="theme" data-value="light">' + t('themeLight') + '</button>' +
          '<button class="' + (S.theme === 'dark' ? 'on' : '') + '" data-act="theme" data-value="dark">' + t('themeDark') + '</button>' +
        '</span></div>' +
      '<div class="lrow"><span class="bd grow">' + t('language') + '</span>' +
        '<span class="mini-seg">' +
          '<button class="' + (S.lang === 'en' ? 'on' : '') + '" data-act="lang" data-value="en">English</button>' +
          '<button class="' + (S.lang === 'he' ? 'on' : '') + '" data-act="lang" data-value="he">עברית</button>' +
        '</span></div>' +
    '</div></div>',

    '<div class="stack g8"><p class="meta ter">' + t('account') + '</p><div class="group">' +
      '<button class="lrow pressable" data-act="about"><span class="bd grow start">' + t('about') + '</span>' + icon('chevron', 'ter') + '</button>' +
      '<button class="lrow pressable" data-act="confirmReset"><span class="bd grow start danger-text">' + t('resetData') + '</span></button>' +
    '</div></div>',
  ].join(''));
}

/** Up to two initials. Takes graphemes, so a Hebrew name works too. */
function monogram(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return Array.from(w[0])[0].toUpperCase();
  return (Array.from(w[0])[0] + Array.from(w[1])[0]).toUpperCase();
}

function viewPlans() {
  const plans = [
    { k: 'free', name: 'Free', price: '$0', features: t('freeF') },
    { k: 'plus', name: 'Plus', price: '$5', features: t('plusF'), rec: true },
    { k: 'pro', name: 'Pro', price: '$15', features: t('proF') },
  ];
  return section([
    '<div class="row navrow"><button class="iconbtn" data-act="back">' + icon('backArrow') + '</button></div>',
    '<h1 class="h1">' + t('changePlan') + '</h1>',
    '<div class="stack g12">' + plans.map((p) =>
      '<button class="plan pressable' + (p.rec ? ' rec' : '') + (S.plan === p.k ? ' current' : '') +
        '" data-act="setPlan" data-value="' + p.k + '">' +
        '<span class="row between g8 full-w"><span class="row g8">' +
          '<span class="h3">' + p.name + '</span>' +
          (p.rec && S.plan !== p.k ? '<span class="chip">' + t('recommended') + '</span>' : '') +
          (S.plan === p.k ? '<span class="chip muted">' + t('currentPlan') + '</span>' : '') +
        '</span><span class="bds">' + p.price + '</span></span>' +
        '<span class="sm sec start">' + esc(p.features) + '</span>' +
      '</button>').join('') + '</div>',
    '<p class="cap ter">' + (S.lang === 'he'
      ? 'באב-טיפוס אפשר להחליף מסלול חופשי כדי לבדוק את המגבלות. באפליקציה האמיתית החנות מאשרת את הרכישה והשרת קובע את ההרשאה.'
      : 'Switch freely here to test the limits. In the real app the store confirms the purchase and the server decides entitlement — the client can never grant itself a plan.') + '</p>',
  ].join(''));
}

function emptyState(title, body, cta, action) {
  return '<div class="empty">' +
    '<p class="h2 center">' + esc(title) + '</p>' +
    (body ? '<p class="bd sec center">' + esc(body) + '</p>' : '') +
    (cta ? '<button class="btn primary" data-act="raw" data-raw="' + esc(action) + '">' + esc(cta) + '</button>' : '') +
    '</div>';
}

function section(inner) {
  return '<div class="stack g24 screen-pad">' + inner + '</div>';
}

/* ---------------------------------------------------------------- sheets -- */

function renderSheet() {
  if (!S.sheet) return '';
  const s = S.sheet;
  let inner = '';

  if (s.type === 'paywall') {
    const isLimit = s.reason !== 'feature';
    inner = [
      '<p class="h2">' + (isLimit ? t('limitTitle', { limit: s.limit }) : esc(s.headline)) + '</p>',
      isLimit ? '<p class="sm sec">' + t('limitBody') + '</p>' : '',
      isLimit ? '<p class="cap ter">' + t('draftKept') + '</p>' : '',
      '<div class="stack g12">',
      planOption('plus', 'Plus', '$5', t('plusF'), true),
      planOption('pro', 'Pro', '$15', t('proF'), false),
      '</div>',
      '<p class="cap ter">' + (S.lang === 'he'
        ? 'המנוי מתחדש אוטומטית אלא אם בוטל 24 שעות לפני סוף התקופה.'
        : 'Subscriptions renew automatically unless cancelled at least 24 hours before the period ends.') + '</p>',
      '<button class="btn ghost" data-act="closeSheet">' + t('notNow') + '</button>',
    ].join('');
  } else if (s.type === 'categories') {
    inner = '<p class="h3">' + t('fCategory') + '</p><div class="group">' +
      CATEGORIES.map((c) =>
        '<button class="lrow pressable" data-act="setCategory" data-value="' + c.slug + '">' +
        '<span class="bd grow start">' + esc(catLabel(c.slug)) + '</span>' +
        (S.draft && S.draft.category === c.slug ? icon('check', 'ok') : '') + '</button>').join('') +
      '</div>';
  } else if (s.type === 'confirm') {
    inner = [
      '<p class="h3">' + esc(s.title) + '</p>',
      s.body ? '<p class="sm sec">' + esc(s.body) + '</p>' : '',
      '<div class="stack g8">',
      '<button class="btn ' + (s.danger ? 'danger-solid' : 'primary') + '" data-act="confirmYes">' + esc(s.confirmLabel) + '</button>',
      '<button class="btn ghost" data-act="closeSheet">' + t('cancel') + '</button>',
      '</div>',
    ].join('');
  } else if (s.type === 'about') {
    inner = [
      '<p class="h3">' + t('about') + '</p>',
      '<p class="sm sec">' + (S.lang === 'he'
        ? 'זהו אב-טיפוס אינטראקטיבי של MY Warranty לדפדפן. חישובי האחריות, מגבלות המסלול והתנהגות ה-Paywall זהים לקוד האפליקציה.'
        : 'This is an interactive prototype of MY Warranty for the browser. The warranty maths, plan limits and paywall behaviour are the same logic as the app.') + '</p>',
      '<p class="sm sec">' + (S.lang === 'he'
        ? 'מה שמדומה: התחברות, סריקת קבלות, ובדיקת הכיסוי — שמבוססת על מילות מפתח ולא על מודל.'
        : 'Simulated here: sign-in, receipt scanning, and the coverage check — which is keyword-driven rather than a real model call.') + '</p>',
      '<p class="sm sec">' + (S.lang === 'he'
        ? 'הנתונים נשמרים בדפדפן שלכם בלבד.'
        : 'Your data stays in this browser only. Nothing is uploaded.') + '</p>',
      '<button class="btn secondary" data-act="closeSheet">' + t('done') + '</button>',
    ].join('');
  }

  return '<div class="scrim" data-act="closeSheet"></div>' +
    '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' +
    '<div class="sheet-body stack g16">' + inner + '</div></div>';
}

function planOption(key, name, price, features, rec) {
  return '<button class="plan pressable' + (rec ? ' rec' : '') + '" data-act="setPlan" data-value="' + key + '" data-from="paywall">' +
    '<span class="row between g8 full-w"><span class="row g8"><span class="h3">' + name + '</span>' +
    (rec ? '<span class="chip">' + t('recommended') + '</span>' : '') + '</span>' +
    '<span class="bds">' + price + '</span></span>' +
    '<span class="sm sec start">' + esc(features) + '</span></button>';
}

/* ---------------------------------------------------------------- chrome -- */

const TABS = [
  { k: 'home', icon: 'home', label: 'tabHome' },
  { k: 'products', icon: 'box', label: 'tabProducts' },
  { k: 'add', icon: 'plus', label: 'tabAdd' },
  { k: 'alerts', icon: 'bell', label: 'tabAlerts' },
  { k: 'profile', icon: 'person', label: 'tabProfile' },
];

const TAB_SCREENS = ['home', 'products', 'alerts', 'profile'];

function renderTabs() {
  if (TAB_SCREENS.indexOf(S.screen) === -1) return '';
  const unread = alertsList().filter((x) => S.readAlerts.indexOf(x.p.id) === -1).length;

  return '<nav class="tabs">' + TABS.map((tb) => {
    if (tb.k === 'add') {
      return '<button class="tab" data-act="go" data-screen="addMethod" aria-label="' + esc(t('tabAdd')) + '">' +
        '<span class="fab">' + icon('plus') + '</span><span class="tlabel">' + t(tb.label) + '</span></button>';
    }
    const on = S.screen === tb.k;
    return '<button class="tab' + (on ? ' on' : '') + '" data-act="tab" data-screen="' + tb.k + '"' +
      ' aria-current="' + (on ? 'page' : 'false') + '">' +
      '<span class="tico">' + icon(tb.icon) +
        (tb.k === 'alerts' && unread ? '<span class="pip">' + unread + '</span>' : '') + '</span>' +
      '<span class="tlabel">' + t(tb.label) + '</span></button>';
  }).join('') + '</nav>';
}

function currentView() {
  switch (S.screen) {
    case 'home': return viewHome();
    case 'products': return viewProducts();
    case 'product': return viewProduct();
    case 'addMethod': return viewAddMethod();
    case 'add': case 'edit': return viewForm();
    case 'coverage': return viewCoverage();
    case 'alerts': return viewAlerts();
    case 'profile': return viewProfile();
    case 'plans': return viewPlans();
    default: return viewHome();
  }
}

function render() {
  const root = document.getElementById('app');
  const dir = STRINGS[S.lang].dir;

  root.setAttribute('dir', dir);
  root.setAttribute('lang', S.lang);
  root.setAttribute('data-theme', S.theme);
  document.documentElement.setAttribute('data-proto-theme', S.theme);

  // Preserve caret position across re-render for the field being typed in.
  const active = document.activeElement;
  const activeField = active && active.dataset ? (active.dataset.field || active.id) : null;
  const caret = active && active.selectionStart !== undefined ? active.selectionStart : null;
  const scrollY = (() => { const b = document.querySelector('.app-body'); return b ? b.scrollTop : 0; })();

  root.innerHTML =
    '<div class="statusbar"><span>9:41</span><span class="sigs"><i class="s1"></i><i class="s2"></i></span></div>' +
    '<div class="app-body">' + currentView() + '</div>' +
    renderTabs() +
    renderSheet() +
    (S.toast ? '<div class="toast" role="status">' + icon('check', 'ok') + '<span class="sm">' + esc(S.toast) + '</span></div>' : '');

  const body = document.querySelector('.app-body');
  if (body && scrollY) body.scrollTop = scrollY;

  if (activeField) {
    const next = root.querySelector('[data-field="' + activeField + '"]') || root.querySelector('#' + activeField);
    if (next && next.focus) {
      next.focus();
      if (caret !== null && next.setSelectionRange) {
        try { next.setSelectionRange(caret, caret); } catch (e) { /* number inputs disallow this */ }
      }
    }
  }
}

/* --------------------------------------------------------------- actions -- */

function resetFilters() { S.query = ''; S.filter = 'all'; render(); }

function saveDraft() {
  const d = S.draft;
  const errors = {};
  if (!d.name || !d.name.trim()) errors.name = t('required');
  if (!d.category) errors.category = t('required');
  if (!d.purchaseDate) errors.purchaseDate = t('required');
  else if (!isCalendarDate(d.purchaseDate)) errors.purchaseDate = t('invalidDate');

  if (Object.keys(errors).length) {
    d._errors = errors;
    render();
    return;
  }
  delete d._errors;

  if (S.screen === 'edit') {
    const idx = S.products.findIndex((x) => x.id === S.params.id);
    if (idx !== -1) {
      S.products[idx] = Object.assign({}, S.products[idx], {
        name: d.name.trim(), category: d.category, brand: d.brand, model: d.model,
        purchaseDate: d.purchaseDate, retailer: d.retailer,
        price: d.price === '' ? null : Number(d.price),
        durationMonths: d.durationMonths, serial: d.serial, notes: d.notes, verified: true,
      });
    }
    S.draft = null;
    persist();
    toast(t('savedToast'));
    replace('product', { id: S.params.id });
    return;
  }

  // The rule this prototype exists to demonstrate: hitting the limit opens the
  // paywall and leaves the draft completely intact.
  const check = canAddProduct(S.plan, S.products.length);
  if (!check.allowed) {
    S.sheet = { type: 'paywall', limit: check.limit };
    render();
    return;
  }

  const id = 'p' + Date.now();
  S.products.push({
    id: id, name: d.name.trim(), brand: d.brand, model: d.model, category: d.category,
    purchaseDate: d.purchaseDate, durationMonths: d.durationMonths, extensionMonths: 0,
    retailer: d.retailer, price: d.price === '' ? null : Number(d.price),
    currency: 'ILS', serial: d.serial, notes: d.notes,
    source: 'user_entered', verified: true, createdAt: Date.now(),
  });
  S.draft = null;
  persist();
  toast(t('savedToast'));
  S.stack = [];
  replace('product', { id: id });
}

document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'tab': tab(el.dataset.screen); break;
    case 'back': back(); break;
    case 'go':
      if (el.dataset.screen === 'addMethod') { S.draft = null; go('addMethod'); }
      else go(el.dataset.screen, { id: el.dataset.id });
      break;
    case 'raw':
      // Small allowlist of inline actions used by empty states.
      if (el.dataset.raw === "go('addMethod')") { S.draft = null; go('addMethod'); }
      else if (el.dataset.raw === 'resetFilters()') resetFilters();
      break;
    case 'filter': S.filter = el.dataset.value; render(); break;
    case 'clearq': S.query = ''; render(); break;

    case 'method': {
      if (el.dataset.wired === 'true') { S.draft = null; go('add'); }
      else toast(t('notWired'));
      break;
    }
    case 'duration': {
      const m = Number(el.dataset.months);
      S.draft.durationMonths = S.draft.durationMonths === m ? null : m;
      render();
      break;
    }
    case 'pickCategory': S.sheet = { type: 'categories' }; render(); break;
    case 'setCategory': {
      S.draft.category = el.dataset.value;
      // Offer the category's typical duration as a suggestion, never silently.
      const c = CATEGORIES.find((x) => x.slug === el.dataset.value);
      if (c && c.months && !S.draft.durationMonths) S.draft.durationMonths = c.months;
      S.sheet = null;
      render();
      break;
    }
    case 'save': saveDraft(); break;

    case 'coverage': S.coverage = null; go('coverage', { id: el.dataset.id }); break;
    case 'coverageReset': S.coverage = null; render(); break;
    case 'runCoverage': {
      if (!PLANS[S.plan].aiCoverage) {
        S.sheet = { type: 'paywall', reason: 'feature', headline: t('coverageLocked') };
        render();
        break;
      }
      const ta = document.getElementById('cov');
      const text = ta ? ta.value : '';
      const p = S.products.find((x) => x.id === el.dataset.id);
      S.coverage = { state: 'analysing', text: text };
      render();
      setTimeout(function () {
        S.coverage = { state: 'done', text: text, result: analyseCoverage(text, p ? p.category : 'other') };
        render();
      }, 1100);
      break;
    }

    case 'confirmDelete': {
      const id = el.dataset.id;
      S.sheet = {
        type: 'confirm', title: t('deleteTitle'), body: t('deleteBody'),
        confirmLabel: t('del'), danger: true,
        onYes: function () {
          S.products = S.products.filter((x) => x.id !== id);
          persist();
          S.sheet = null;
          S.stack = [];
          replace('products');
          toast(t('deletedToast'));
        },
      };
      render();
      break;
    }
    case 'confirmReset': {
      S.sheet = {
        type: 'confirm', title: t('resetTitle'), body: t('resetBody'),
        confirmLabel: t('resetData'), danger: true,
        onYes: function () {
          const theme = S.theme, lang = S.lang;
          S = defaultState();
          S.theme = theme; S.lang = lang; S.onboarded = true;
          persist();
          replace('home');
          toast(t('done'));
        },
      };
      render();
      break;
    }
    case 'confirmYes': if (S.sheet && S.sheet.onYes) S.sheet.onYes(); break;
    case 'closeSheet': S.sheet = null; render(); break;
    case 'about': S.sheet = { type: 'about' }; render(); break;

    case 'setPlan': {
      S.plan = el.dataset.value;
      persist();
      if (el.dataset.from === 'paywall') {
        const wasLimit = S.sheet && S.sheet.reason !== 'feature';
        S.sheet = null;
        // For a limit paywall the draft is still in state, so saving now just
        // works — that is the whole point of the rule. For a feature paywall
        // there is nothing to save; the screen simply unlocks.
        if (wasLimit && S.draft) saveDraft(); else render();
      } else {
        render();
        toast(S.plan.charAt(0).toUpperCase() + S.plan.slice(1));
      }
      break;
    }
    case 'theme':
      S.theme = el.dataset.value; persist(); render(); break;
    case 'lang':
      S.lang = el.dataset.value; persist(); render(); break;
    case 'readAll':
      S.readAlerts = S.products.map((p) => p.id); persist(); render(); break;
  }
});

document.addEventListener('input', function (e) {
  const el = e.target;
  if (el.id === 'q') { S.query = el.value; render(); return; }
  if (el.dataset && el.dataset.field && S.draft) {
    S.draft[el.dataset.field] = el.value;
    if (S.draft._errors && S.draft._errors[el.dataset.field]) {
      delete S.draft._errors[el.dataset.field];
    }
    // Re-render only when the change affects derived output, to keep typing smooth.
    if (el.dataset.field === 'purchaseDate') render();
  }
});

/* Escape closes a sheet, matching the app's back-gesture behaviour. */
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
});

restore();
render();
