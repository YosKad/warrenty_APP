import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { formatDate, isolateLtr } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import type {
  MatchState,
  ProviderLink,
  WarrantyIntelligence,
} from '@/domain/warrantyIntelligence';
import { CheckIcon, ChevronIcon, InfoIcon, Text } from '@/ui';

/**
 * "Your warranty".
 *
 * The section that has to answer four things at a glance — what applies, who
 * honours it, how long it lasts, and how we know — without turning into a table
 * of database fields.
 *
 * Three rules govern what appears:
 *
 *   1. A field we do not know is absent, not an empty row. Nine rows with four
 *      dashes reads as a broken import.
 *   2. The provider chain is never collapsed. Samsung makes the television and
 *      Samline honours the warranty; showing one word for both is how a user ends
 *      up phoning the wrong company.
 *   3. Provenance is on the surface, not behind a tap. The match state and the
 *      source line sit under the headline, because a warranty you cannot trace is
 *      one you should not act on.
 */

export type WarrantyIntelligenceSectionProps = {
  intelligence: WarrantyIntelligence;
  onOpenCoverage: () => void;
  onOpenSource: () => void;
  onResolveConflict: () => void;
  onAddWarranty: () => void;
  onUploadDocument: () => void;
  onScanReceipt: () => void;
  onSearchAgain: () => void;
  searching?: boolean;
};

export function WarrantyIntelligenceSection({
  intelligence,
  onOpenCoverage,
  onOpenSource,
  onResolveConflict,
  onAddWarranty,
  onUploadDocument,
  onScanReceipt,
  onSearchAgain,
  searching = false,
}: WarrantyIntelligenceSectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);

  if (!intelligence.policy || intelligence.matchState === 'unknown') {
    return (
      <NotIdentified
        onAddWarranty={onAddWarranty}
        onUploadDocument={onUploadDocument}
        onScanReceipt={onScanReceipt}
        onSearchAgain={onSearchAgain}
        searching={searching}
      />
    );
  }

  const { policy, source } = intelligence;
  const clauseCount =
    intelligence.clauses.covered.length +
    intelligence.clauses.notCovered.length +
    intelligence.clauses.specialConditions.length;

  return (
    <View
      style={{
        gap: theme.spacing.lg,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="metadata" tone="tertiary">
          {t('warrantyIntel.title').toUpperCase()}
        </Text>
        <Text variant="h3" accessibilityRole="header" style={{ writingDirection: 'auto' }}>
          {headline(intelligence, t)}
        </Text>
        <MatchChip state={intelligence.matchState} />
      </View>

      {intelligence.conflicts.length > 0 ? (
        <ConflictNotice
          intelligence={intelligence}
          onResolve={onResolveConflict}
        />
      ) : null}

      {/* Progressive disclosure: the chain is what people actually want, so the
          two roles that matter are always visible and the rest expand. */}
      <ProviderChainList
        links={intelligence.providerChain}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />

      <View style={{ gap: theme.spacing.sm }}>
        {source ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('warrantyIntel.sourceLabel')}. ${
              source.documentTitle ?? t(`warranty.source.${source.kind}`)
            }`}
            onPress={onOpenSource}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <InfoIcon size={16} color={theme.colors.text.tertiary} />
            <Text
              variant="caption"
              tone="tertiary"
              numberOfLines={1}
              style={{ flex: 1, writingDirection: 'auto' }}
            >
              {source.documentTitle ?? t(`warranty.source.${source.kind}`)}
              {policy.policyVersion ? ` · ${isolateLtr(policy.policyVersion)}` : ''}
            </Text>
            <ChevronIcon size={14} color={theme.colors.text.tertiary} />
          </Pressable>
        ) : null}

        {source?.lastVerifiedAt ? (
          <Text variant="caption" tone="tertiary">
            {t('warrantyIntel.lastChecked')}:{' '}
            {formatDate(source.lastVerifiedAt.slice(0, 10), locale, 'medium')}
          </Text>
        ) : null}
      </View>

      {clauseCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenCoverage}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing.sm,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radii.md,
            backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.accent.soft,
          })}
        >
          <Text variant="bodySmallStrong" style={{ color: theme.colors.accent.text }}>
            {t('warrantyIntel.seeWhatsCovered')}
          </Text>
          <ChevronIcon size={16} color={theme.colors.accent.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * "2-year official importer warranty". Built from the duration and the role that
 * actually honours it, so the headline says something a generic "warranty" does
 * not. Falls back to a plain statement when the length is unknown — never to a
 * typical value.
 */
function headline(
  intelligence: WarrantyIntelligence,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const months = intelligence.policy?.durationMonths ?? null;
  if (months === null) return t('warrantyIntel.headlineUnknownLength');

  const duration =
    months % 12 === 0
      ? t('warrantyIntel.durationYears', { count: months / 12 })
      : t('warrantyIntel.durationMonths', { count: months });

  const provider = intelligence.providerChain.find((p) => p.role === 'warranty_provider');
  const importer = intelligence.providerChain.find((p) => p.role === 'importer');

  // The importer honouring its own warranty is the case worth naming — it is
  // what tells an Israeli buyer their cover is local rather than imported.
  if (provider && importer && provider.organisationId === importer.organisationId) {
    return t('warrantyIntel.headlineImporter', { duration });
  }
  const manufacturer = intelligence.providerChain.find((p) => p.role === 'manufacturer');
  if (provider && manufacturer && provider.organisationId === manufacturer.organisationId) {
    return t('warrantyIntel.headlineManufacturer', { duration });
  }
  const retailer = intelligence.providerChain.find((p) => p.role === 'retailer');
  if (provider && retailer && provider.organisationId === retailer.organisationId) {
    return t('warrantyIntel.headlineRetailer', { duration });
  }
  return t('warrantyIntel.headlineGeneric', { duration });
}

/**
 * The match state as a word, never a percentage. A user cannot check what "83%
 * confident" means; they can act on "needs confirmation".
 */
export function MatchChip({ state }: { state: MatchState }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const tone =
    state === 'verified'
      ? { fg: theme.colors.protection.activeFg, bg: theme.colors.protection.activeBg }
      : state === 'strong'
        ? { fg: theme.colors.accent.text, bg: theme.colors.accent.soft }
        : state === 'needs_confirmation'
          ? { fg: theme.colors.protection.endingFg, bg: theme.colors.protection.endingBg }
          : { fg: theme.colors.protection.unknownFg, bg: theme.colors.protection.unknownBg };

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingVertical: 4,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radii.pill,
        backgroundColor: tone.bg,
      }}
    >
      {state === 'verified' ? <CheckIcon size={12} color={tone.fg} /> : null}
      <Text variant="caption" style={{ color: tone.fg }}>
        {t(`warrantyIntel.match.${state}`)}
      </Text>
    </View>
  );
}

/**
 * The five roles, as five rows. Two are shown by default — the ones a person
 * needs when something breaks — and the rest are one tap away.
 */
function ProviderChainList({
  links,
  expanded,
  onToggle,
}: {
  links: ProviderLink[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (links.length === 0) return null;

  const priority: ProviderLink['role'][] = [
    'warranty_provider',
    'service_provider',
    'manufacturer',
    'importer',
    'retailer',
  ];
  const ordered = [...links].sort(
    (a, b) => priority.indexOf(a.role) - priority.indexOf(b.role),
  );
  const visible = expanded ? ordered : ordered.slice(0, 2);
  const hidden = ordered.length - visible.length;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {visible.map((link) => (
        <View
          key={link.role}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text variant="caption" tone="tertiary">
              {t(`warrantyIntel.role.${link.role}`)}
            </Text>
            <Text
              variant="bodySmallStrong"
              numberOfLines={1}
              style={{ writingDirection: 'auto' }}
            >
              {link.name}
            </Text>
            {/* Plain language under the role, so nobody has to know what an
                "importer" is in warranty terms to use this screen. */}
            <Text variant="caption" tone="tertiary">
              {link.isUserProvided
                ? t('warrantyIntel.userProvided')
                : t(`warrantyIntel.roleHelp.${link.role}`)}
            </Text>
          </View>
        </View>
      ))}

      {hidden > 0 || expanded ? (
        <Pressable accessibilityRole="button" onPress={onToggle} hitSlop={8}>
          <Text variant="caption" tone="accent">
            {expanded
              ? t('warrantyIntel.showLess')
              : t('warrantyIntel.showAll', { count: ordered.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Two sources disagree. Shown rather than resolved silently — the whole reason
 * the conflict is detected is that picking one would be arbitrary.
 */
function ConflictNotice({
  intelligence,
  onResolve,
}: {
  intelligence: WarrantyIntelligence;
  onResolve: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const conflict = intelligence.conflicts[0];
  if (!conflict) return null;

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.protection.endingBg,
      }}
    >
      <Text
        variant="bodySmallStrong"
        style={{ color: theme.colors.protection.endingFg }}
      >
        {t('warrantyIntel.conflictTitle')}
      </Text>
      <Text variant="caption" style={{ color: theme.colors.protection.endingFg }}>
        {conflict.field === 'duration_months'
          ? t('warrantyIntel.conflictDuration', {
              chosen: conflict.chosen,
              alternative: conflict.alternative,
            })
          : t('warrantyIntel.conflictProvider', {
              chosen: conflict.chosen,
              alternative: conflict.alternative,
            })}
      </Text>
      <Text variant="caption" style={{ color: theme.colors.protection.endingFg }}>
        {t('warrantyIntel.conflictBody')}
      </Text>
      <Pressable accessibilityRole="button" onPress={onResolve} hitSlop={8}>
        <Text
          variant="bodySmallStrong"
          style={{ color: theme.colors.protection.endingFg }}
        >
          {t('warrantyIntel.conflictResolve')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The honest empty state.
 *
 * This is the state item 10 of the brief is about: it must look intentional
 * rather than broken, because "we don't know" is a legitimate answer and the
 * alternative — a plausible 12-month guess — is the single worst thing this
 * product could do.
 */
function NotIdentified({
  onAddWarranty,
  onUploadDocument,
  onScanReceipt,
  onSearchAgain,
  searching,
}: {
  onAddWarranty: () => void;
  onUploadDocument: () => void;
  onScanReceipt: () => void;
  onSearchAgain: () => void;
  searching: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const actions = [
    { key: 'upload', label: t('warrantyIntel.actionUploadDocument'), onPress: onUploadDocument },
    { key: 'manual', label: t('warrantyIntel.actionAddManually'), onPress: onAddWarranty },
    { key: 'scan', label: t('warrantyIntel.actionScanReceipt'), onPress: onScanReceipt },
    // Last, because it is the only one that changes nothing about what we know.
    // Offering it first would suggest the app simply has not tried yet.
    {
      key: 'again',
      label: searching ? t('common.loading') : t('warrantyIntel.actionSearchAgain'),
      onPress: onSearchAgain,
    },
  ];

  return (
    <View
      style={{
        gap: theme.spacing.lg,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="metadata" tone="tertiary">
          {t('warrantyIntel.title').toUpperCase()}
        </Text>
        <Text variant="h3" accessibilityRole="header">
          {t('warrantyIntel.notIdentifiedTitle')}
        </Text>
        <Text variant="bodySmall" tone="secondary">
          {t('warrantyIntel.notIdentifiedBody')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
            })}
          >
            <Text variant="bodySmall">{action.label}</Text>
            <ChevronIcon size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
