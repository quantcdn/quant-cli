/**
 * Handle the delete response.
 */

/**
 * Handle the delete response.
 * @param {*} error 
 * @returns [boolean, string]
 *   - Success, if the delete was successful
 *   - Message, the message from the response
 */
const deleteResponse = function(error) {
    const reponseData = error.message.match(/Response: (.*)/s);
    if (reponseData) {
        const responseData = JSON.parse(reponseData[1]);
        if (responseData.meta && responseData.meta[0]) {
            const meta = responseData.meta[0];
            if (meta.deleted) {
                return [true, "success"];
            }
            if (meta.deleted_timestamp) {
                return [true, "already deleted"];
            }
        }
    }

    return [false, "unknown error"];
}

module.exports = deleteResponse;