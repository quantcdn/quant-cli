/**
 * Deploy an edge filter function.
 *
 * @usage
 *   quant filter <file> <description> <uuid>
 */
import { singleFunctionCommand } from '../helper/single-function-command.js';

export default singleFunctionCommand({ name: 'filter', noun: 'edge filter', method: 'edgeFilter', sample: 'filter.js' });
