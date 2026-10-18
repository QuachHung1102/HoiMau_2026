// Codegen spec for the in-repo Android module (android/app/src/main/java/com/hoi_mau/HoiMauNativeModule.kt).
// Only hoiMauNative.ts imports this file.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  setKeepAwake(on: boolean): void;
  shareTextFile(fileName: string, mimeType: string, content: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('HoiMauNative');
