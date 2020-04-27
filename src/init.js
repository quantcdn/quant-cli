/**
 * Create a quant configuration file and test the connection.
 *
 * @param {string} clientId
 *   The client ID.
 * @param {string} token
 *   The client token.
 * @param {string} endpoint
 *   The Quant upload API endpoint.
 * @param {string} dir
 *   The source directory.
 */
module.exports = (clientId, token, endpoint = 'https://api.quantcdn.io', dir = 'build') => {

  const config = {
    clientid: clientId,
    token: token,
    endpoint: endpoint
  }

};
