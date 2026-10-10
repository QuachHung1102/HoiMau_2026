let creds: { username: string; password: string } | false = false;
export const setGenericPassword = async (username: string, password: string) => {
  creds = { username, password };
  return { service: 'preview', storage: 'memory' };
};
export const getGenericPassword = async () =>
  creds && { ...creds, service: 'preview', storage: 'memory' };
export const resetGenericPassword = async () => {
  creds = false;
  return true;
};
