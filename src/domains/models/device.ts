// RT_67 : plateformes d'appareil reconnues.
export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

// RG_54 : auteur d'une version, tel que présenté au joueur (DeviceLabel).
export interface DeviceLabel {
  id: string;
  name: string;
  platform: DevicePlatform;
}
