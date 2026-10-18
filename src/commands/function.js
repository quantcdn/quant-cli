/**
 * Deploy an edge function.
 *
 * @usage
 *   quant function <file> <description> <uuid>
 */
import { singleFunctionCommand } from '../helper/single-function-command.js';

export default singleFunctionCommand({ name: 'function', noun: 'edge function', method: 'edgeFunction', sample: 'handler.js' });
