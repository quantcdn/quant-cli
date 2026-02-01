/**
 * Array helper functions used throughout the project.
 */

/**
 * Chunk an array into smaller parts.
 *
 * @param {array} array The array to chunk
 * @param {int} size The number of items per chunk
 *
 * @return {array}
 *   An array containing chunks.
 */
export function chunk(array, size = 10) {
  if (array.length <= size) {
    return [array];
  }
  return [array.slice(0, size), ...chunk(array.slice(size), size)];
}
