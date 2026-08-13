import { useEffect, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '@/theme';
import { getProductImageUrl } from '@/services/documentService';
import { ProductIllustration } from './ProductIllustration';

/**
 * Product imagery.
 *
 * Resolution order, most specific first:
 *   1. the user's own photo (private storage, signed URL)
 *   2. a recognition/catalogue image, when one is available and licensed
 *   3. the category illustration
 *
 * There is deliberately no fourth step. A grey square with a generic mark is
 * what V1 did, and it is the single biggest reason the product list read as a
 * database view rather than a wallet.
 */

export type ProductImageProps = {
  /** Storage path in the private `product-images` bucket. */
  imagePath?: string | null;
  /** Public catalogue image, when one is available. */
  imageUrl?: string | null;
  category?: string | null;
  /** Product name — lets the illustration pick a vacuum over a washing machine. */
  name?: string | null;
  size?: number;
  radius?: number;
  style?: ViewStyle;
};

/** What a resolution attempt produced, tagged with the path it was for. */
type Resolution = { path: string; url: string | null };

export function ProductImage({
  imagePath,
  imageUrl,
  category,
  name,
  size = 56,
  radius,
  style,
}: ProductImageProps) {
  const theme = useTheme();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath) return;
    let cancelled = false;

    // The bucket is private, so the URL has to be minted and will expire.
    // A failure resolves to `null` rather than throwing, which falls through to
    // the illustration and keeps the row looking intentional rather than broken.
    void getProductImageUrl(imagePath)
      .then((url) => {
        if (!cancelled) setResolution({ path: imagePath, url });
      })
      .catch(() => {
        if (!cancelled) setResolution({ path: imagePath, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  // Derived rather than stored, so a resolution left over from a previous
  // `imagePath` is ignored without needing to reset state inside the effect.
  const signedUrl =
    resolution && imagePath && resolution.path === imagePath ? resolution.url : null;
  const source = signedUrl ?? imageUrl ?? null;
  const failed = source !== null && failedSource === source;

  const boxRadius = radius ?? Math.round(size * 0.26);

  const container: ViewStyle = {
    width: size,
    height: size,
    borderRadius: boxRadius,
    overflow: 'hidden',
    backgroundColor: theme.colors.bg.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    ...style,
  };

  if (source && !failed) {
    return (
      <View style={container}>
        <Image
          source={{ uri: source }}
          contentFit="cover"
          transition={180}
          onError={() => setFailedSource(source)}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    );
  }

  return (
    <View style={container}>
      <ProductIllustration category={category} hint={name} size={Math.round(size * 0.62)} />
    </View>
  );
}
