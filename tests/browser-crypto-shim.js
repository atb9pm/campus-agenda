export function randomUUID() {
  return globalThis.crypto.randomUUID();
}

export function createHash() {
  let value = "";
  return {
    update(next) {
      value += String(next);
      return this;
    },
    digest() {
      return value;
    },
  };
}
