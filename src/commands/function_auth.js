/**
 * Deploy an edge auth function. It returns 201 to let the request continue.
 *
 * @usage
 *   quant auth <file> <description> <uuid>
 */
import { singleFunctionCommand } from '../helper/single-function-command.js';

export default singleFunctionCommand({ name: 'auth', noun: 'edge auth function', method: 'edgeAuth', sample: 'auth.js' });
