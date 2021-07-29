/**
 * Array helper functions used throughout the project.
 */

/**
 * Chunk an array into smaller parts.
 *
 * @param {array} array The array to chunk
 * @param {int} size The number of items per chunk
 *
 * @returns {array}
 *   An array containing chunks.
 */
const chunk = (array, size) => {
  if (array.length <= size) {
    return [array];
  }
  return [array.slice(0, size), ...chunk(array.slice(size), size)];
};

module.exports = {
  chunk,
};
