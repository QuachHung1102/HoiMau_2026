import type * as Wrapper from './hoiMauNative';

type Native = { setKeepAwake: jest.Mock; shareTextFile: jest.Mock };

// The spec module reads NativeModules.HoiMauNative when it is first imported, so each case loads a fresh copy of
// react-native and the wrapper after setting the platform and the mock.
function load(os: 'android' | 'ios', native: Native | undefined) {
  jest.resetModules();
  const RN = require('react-native');
  RN.Platform.OS = os;
  RN.NativeModules.HoiMauNative = native;
  const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  const wrapper: typeof Wrapper = require('./hoiMauNative');
  return { ...wrapper, share };
}

const mockNative = (): Native => ({
  setKeepAwake: jest.fn(),
  shareTextFile: jest.fn().mockResolvedValue(null),
});

describe('setKeepAwake', () => {
  test('calls through on Android with true and false', () => {
    const native = mockNative();
    const { setKeepAwake } = load('android', native);
    setKeepAwake(true);
    setKeepAwake(false);
    expect(native.setKeepAwake.mock.calls).toEqual([[true], [false]]);
  });

  test('a missing module does not throw', () => {
    const { setKeepAwake } = load('android', undefined);
    expect(() => setKeepAwake(true)).not.toThrow();
  });

  test('a module that throws does not throw', () => {
    const native = mockNative();
    native.setKeepAwake.mockImplementation(() => {
      throw new Error('no window');
    });
    const { setKeepAwake } = load('android', native);
    expect(() => setKeepAwake(true)).not.toThrow();
    expect(native.setKeepAwake).toHaveBeenCalledWith(true);
  });

  test('on iOS the module is not called', () => {
    const native = mockNative();
    const { setKeepAwake } = load('ios', native);
    setKeepAwake(true);
    expect(native.setKeepAwake).not.toHaveBeenCalled();
  });
});

describe('shareTextFile', () => {
  test('native success resolves without the text fallback', async () => {
    const native = mockNative();
    const { shareTextFile, share } = load('android', native);
    await expect(shareTextFile('export.json', 'application/json', '{"a":1}')).resolves.toBeUndefined();
    expect(native.shareTextFile).toHaveBeenCalledWith('export.json', 'application/json', '{"a":1}');
    expect(share).not.toHaveBeenCalled();
  });

  test('a native rejection with short content falls back to Share', async () => {
    const native = mockNative();
    native.shareTextFile.mockRejectedValue(new Error('E_SHARE'));
    const { shareTextFile, share } = load('android', native);
    await shareTextFile('export.json', 'application/json', '{"a":1}');
    expect(share).toHaveBeenCalledWith({ title: 'export.json', message: '{"a":1}' });
  });

  test('a native rejection with 100 001 characters throws ShareUnavailableError', async () => {
    const native = mockNative();
    native.shareTextFile.mockRejectedValue(new Error('E_SHARE'));
    const { shareTextFile, share, ShareUnavailableError } = load('android', native);
    await expect(shareTextFile('export.json', 'application/json', 'x'.repeat(100_001))).rejects.toBeInstanceOf(
      ShareUnavailableError,
    );
    expect(share).not.toHaveBeenCalled();
  });

  test('exactly 100 000 characters still use the fallback', async () => {
    const { shareTextFile, share } = load('android', undefined);
    await shareTextFile('export.json', 'application/json', 'x'.repeat(100_000));
    expect(share).toHaveBeenCalledTimes(1);
  });

  test('a missing module uses the fallback', async () => {
    const { shareTextFile, share } = load('android', undefined);
    await shareTextFile('export.json', 'application/json', '{"a":1}');
    expect(share).toHaveBeenCalledWith({ title: 'export.json', message: '{"a":1}' });
  });

  test('on iOS the module is not called and the fallback is used', async () => {
    const native = mockNative();
    const { shareTextFile, share } = load('ios', native);
    await shareTextFile('export.json', 'application/json', '{"a":1}');
    expect(native.shareTextFile).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledTimes(1);
  });
});
