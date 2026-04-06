export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store?(key: string, value: string): PromiseLike<void>;
  delete?(key: string): PromiseLike<void>;
}