// JS side of the in-repo Android module (AR-27). The module can only be compile-verified here, so every call is
// guarded and has a non-native fallback; no other file may reach the module directly.
import { Platform, Share } from 'react-native';
import NativeHoiMauNative from './NativeHoiMauNative';

export class ShareUnavailableError extends Error {
  name = 'ShareUnavailableError';
}

const TEXT_FALLBACK_MAX_CHARS = 100_000;

const nativeModule = () => (Platform.OS === 'android' ? NativeHoiMauNative : null);

// Spec F-05: a wake lock that is not supported is skipped silently.
export function setKeepAwake(on: boolean): void {
  try {
    nativeModule()?.setKeepAwake(on);
  } catch {}
}

export async function shareTextFile(fileName: string, mimeType: string, content: string): Promise<void> {
  const native = nativeModule();
  if (native) {
    try {
      await native.shareTextFile(fileName, mimeType, content);
      return;
    } catch {}
  }
  // ponytail: text fallback capped at 100 000 chars (Android binder limit); the native path has no cap
  if (content.length > TEXT_FALLBACK_MAX_CHARS) {
    throw new ShareUnavailableError(`${fileName}: ${content.length} chars is too long to share as text`);
  }
  await Share.share({ title: fileName, message: content });
}
