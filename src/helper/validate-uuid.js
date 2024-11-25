/**
 * UUID validation helper
 * 
 * @param {string} uuid - The UUID to validate
 * @returns {boolean} - True if valid UUID, false otherwise
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[4-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUUID(uuid) {
  if (!uuid) return true; // Allow empty for new functions
  return UUID_REGEX.test(uuid);
}

module.exports = {
  validateUUID,
  UUID_REGEX
}; 