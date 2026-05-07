// The small RentGuard logo mark (icon-only). Used in Loading card + SignInModal.

import Image from 'next/image';

export function Mark({ size = 36 }: { size?: number }) {
  return (
    <Image
      src="/logo-mark.png"
      alt="RentGuard"
      width={size}
      height={size}
      style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
    />
  );
}
