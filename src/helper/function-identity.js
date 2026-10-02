import { createHash } from 'node:crypto';
export function functionUuid(customer, project, id) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error('Function id must be a lowercase slug (1–48 characters)');
  const hex = createHash('sha256').update(JSON.stringify([customer, project, id])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
