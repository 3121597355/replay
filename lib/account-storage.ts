let owner = 'local';
export function setStorageOwner(value: string) { owner = /^[a-z0-9-]{1,64}$/i.test(value) ? value : 'local'; }
export function getStorageOwner() { return owner; }
export function storageKey(base: string) { return owner === 'local' ? base : `${base}.${owner}`; }
export function storagePrefix(base: string) { return `${storageKey(base)}.`; }
