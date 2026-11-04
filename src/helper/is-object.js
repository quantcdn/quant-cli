/** True for a plain object value: not null and not an array. */
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
