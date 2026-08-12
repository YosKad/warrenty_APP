import { Platform, Pressable, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { getUnreadCount } from '@/services/notificationService';
import { BellIcon, HomeIcon, PersonIcon, PlusIcon, Text, WarrantyMarkIcon } from '@/ui';

/**
 * Bottom navigation.
 *
 * Five destinations, with Add as a raised centre action rather than a sixth peer —
 * adding a product is the one thing the app most wants to be effortless, and burying
 * it in a list of tabs makes it feel like a chore.
 *
 * The centre button pushes a modal rather than switching tabs, so the user's place in
 * whatever they were doing is preserved when they cancel.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const unread = useQuery({
    queryKey: queryKeys.alerts.unreadCount,
    queryFn: getUnreadCount,
    staleTime: 60 * 1000,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.text.primary,
        tabBarInactiveTintColor: theme.colors.text.tertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.bg.surface,
          borderTopColor: theme.colors.border.subtle,
          borderTopWidth: theme.borderWidth.hairline,
          height: Platform.OS === 'ios' ? 84 : 68,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color }) => <HomeIcon color={String(color)} size={24} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: t('tabs.products'),
          tabBarIcon: ({ color }) => <WarrantyMarkIcon color={String(color)} size={24} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarButton: () => <AddButton onPress={() => router.push('/add')} />,
        }}
        listeners={{
          // The tab itself is never focusable; the button opens the modal instead.
          tabPress: (event) => event.preventDefault(),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: t('tabs.alerts'),
          tabBarBadge: unread.data && unread.data > 0 ? unread.data : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.status.expiredFg,
            color: theme.colors.text.onBrand,
            fontSize: 11,
          },
          tabBarIcon: ({ color }) => <BellIcon color={String(color)} size={24} />,
          tabBarAccessibilityLabel:
            unread.data && unread.data > 0
              ? `${t('tabs.alerts')}, ${t('a11y.unreadAlerts', { count: unread.data })}`
              : t('tabs.alerts'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color }) => <PersonIcon color={String(color)} size={24} />,
        }}
      />
    </Tabs>
  );
}

function AddButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('a11y.addProduct')}
        onPress={onPress}
        style={({ pressed }) => ({
          width: 52,
          height: 40,
          borderRadius: theme.radii.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed
            ? theme.colors.control.primaryBgPressed
            : theme.colors.control.primaryBg,
          marginTop: 2,
        })}
      >
        <PlusIcon color={theme.colors.control.primaryFg} size={22} />
      </Pressable>
      <Text variant="caption" tone="tertiary" style={{ fontSize: 11, marginTop: 3 }}>
        {t('tabs.add')}
      </Text>
    </View>
  );
}
