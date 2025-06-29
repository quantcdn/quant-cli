/**
 * Check if an error indicates an MD5 match
 * 
 * @param {Error} error - The error to check
 * @returns {boolean} - True if the error indicates an MD5 match
 */
function isMD5Match(error) {
  if (!error) return false;

  // Check for any kind of MD5 match message
  if (error.response && error.response.data && error.response.data.errorMsg) {
    if (error.response.data.errorMsg === 'MD5 already matches existing file.' ||
        error.response.data.errorMsg.includes('Published version already has md5')) {
      return true;
    }
  }

  if (error.message) {
    if (error.message.includes('Published version already has md5') ||
        error.message.includes('MD5 already matches')) {
      return true;
    }
  }

  return false;
}

module.exports = isMD5Match; 