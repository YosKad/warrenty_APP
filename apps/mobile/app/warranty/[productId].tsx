import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { useProduct } from '@/hooks/useProducts';
import { useWarrantyIntelligence } from '@/hooks/useWarrantyIntelligence';
import { clauseHeadline, type WarrantyClause } from '@/domain/warrantyIntelligence';
import { ClauseSourceSheet } from '@/features/warranty/ClauseSourceSheet';
import { MatchChip } from '@/features/warranty/WarrantyIntelligenceSection';
import {
  BackIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  InfoIcon,
  ListSkeleton,
  Screen,
  Text,
} from '@/ui';

/**
 * What's covered.
 *
 * Every line on this screen comes from a clause in a real warranty document.
 * Nothing is generated to fill a section out, and a section with no clauses is
 * absent rather than padded with the sort of generic appliance terms that would
 * be right often enough to be dangerous.
 *
 * Coverage and exclusions get different marks *and* different colours, because
 * the distinction between "covered" and "not covered" is the one thing on this
 * screen that must survive greyscale and colour-vision deficiency.
 */
export default function WhatsCoveredScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const id = productId ?? '';

  const product = useProduct(id);
  const intelligence = useWarrantyIntelligence(id);
  const [openClause, setOpenClause] = useState<WarrantyClause | null>(null);

  const intel = intelligence.data;

  useEffect(() => {
    if (!intel) return;
    track({
      name: 'warranty_intelligence_viewed',
      props: {
        matchState: intel.matchState,
        hasConflict: intel.conflicts.length > 0,
        clauseCount:
          intel.clauses.covered.length +
          intel.clauses.notCovered.length +
          intel.clauses.specialConditions.length,
      },
    });
  }, [intel]);

  return (
    <Screen scroll>
      <View style={{ height: 44, justifyContent: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.back')}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <BackIcon color={theme.colors.text.primary} />
        </Pressable>
      </View>

      <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.sm }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="h1" accessibilityRole="header">
            {t('warrantyIntel.covered')}
          </Text>
          {product.data ? (
            <Text variant="bodySmall" tone="tertiary" style={{ writingDirection: 'auto' }}>
              {product.data.name}
            </Text>
          ) : null}
          {intel ? <MatchChip state={intel.matchState} /> : null}
        </View>

        {intelligence.isLoading ? (
          <ListSkeleton count={3} />
        ) : !intel || !intel.policy ? (
          <EmptyTerms />
        ) : (
          <>
            <ClauseGroup
              title={t('warrantyIntel.covered')}
              clauses={intel.clauses.covered}
              tone="covered"
              onOpen={setOpenClause}
            />
            <ClauseGroup
              title={t('warrantyIntel.notCovered')}
              clauses={intel.clauses.notCovered}
              tone="excluded"
              onOpen={setOpenClause}
            />
            <ClauseGroup
              title={t('warrantyIntel.specialConditions')}
              clauses={intel.clauses.specialConditions}
              tone="condition"
              onOpen={setOpenClause}
            />
            <ClauseGroup
              title={t('warrantyIntel.claimRequirements')}
              clauses={intel.clauses.claimRequirements}
              tone="condition"
              onOpen={setOpenClause}
            />
            <ClauseGroup
              title={t('warrantyIntel.territory')}
              clauses={intel.clauses.geographic}
              tone="condition"
              onOpen={setOpenClause}
            />

            <Text variant="caption" tone="tertiary">
              {t('coverage.disclaimer')}
            </Text>
          </>
        )}
      </View>

      <ClauseSourceSheet
        clause={openClause}
        source={intel?.source ?? null}
        onDismiss={() => setOpenClause(null)}
      />
    </Screen>
  );
}

type ClauseTone = 'covered' | 'excluded' | 'condition';

function ClauseGroup({
  title,
  clauses,
  tone,
  onOpen,
}: {
  title: string;
  clauses: WarrantyClause[];
  tone: ClauseTone;
  onOpen: (clause: WarrantyClause) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  // A section with nothing in it is absent. Padding it out with plausible
  // generic terms is the failure mode this whole phase exists to avoid.
  if (clauses.length === 0) return null;

  const color =
    tone === 'covered'
      ? theme.colors.protection.activeFg
      : tone === 'excluded'
        ? theme.colors.protection.expiredFg
        : theme.colors.text.secondary;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="h3" accessibilityRole="header">
        {title}
      </Text>

      <View
        style={{
          borderRadius: theme.radii.xl,
          backgroundColor: theme.colors.bg.surface,
          overflow: 'hidden',
        }}
      >
        {clauses.map((clause, index) => (
          <Pressable
            key={clause.id}
            accessibilityRole="button"
            accessibilityLabel={`${clauseHeadline(clause)}. ${t('warrantyIntel.viewSource')}`}
            onPress={() => onOpen(clause)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: theme.spacing.md,
              padding: theme.spacing.lg,
              backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
              borderTopWidth: index === 0 ? 0 : theme.borderWidth.hairline,
              borderTopColor: theme.colors.border.subtle,
            })}
          >
            <View style={{ marginTop: 2 }}>
              <ClauseMark tone={tone} color={color} />
            </View>

            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="bodySmallStrong" style={{ writingDirection: 'auto' }}>
                {clause.title ?? clauseHeadline(clause)}
              </Text>
              {clause.summary ? (
                <Text variant="caption" tone="secondary" style={{ writingDirection: 'auto' }}>
                  {clause.summary}
                </Text>
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  marginTop: 2,
                }}
              >
                <Text variant="caption" tone="accent">
                  {t('warrantyIntel.viewSource')}
                </Text>
                <ChevronIcon size={12} color={theme.colors.text.accent} />
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * A tick, a cross or a dot. Shape carries the meaning; colour reinforces it.
 * Colour alone would make "covered" and "not covered" identical in greyscale.
 */
function ClauseMark({ tone, color }: { tone: ClauseTone; color: string }) {
  if (tone === 'covered') return <CheckIcon size={16} color={color} />;
  if (tone === 'excluded') return <CloseIcon size={16} color={color} />;
  return <InfoIcon size={16} color={color} />;
}

function EmptyTerms() {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={{
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <Text variant="bodySmall" tone="secondary">
        {t('warrantyIntel.noClauses')}
      </Text>
    </View>
  );
}
