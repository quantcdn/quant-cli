import { expect } from 'chai';
import sinon from 'sinon';
import yargs from 'yargs';
import config from '../../../src/config.js';

const commands = {
  function: (await import('../../../src/commands/function.js')).default,
  auth: (await import('../../../src/commands/function_auth.js')).default,
  filter: (await import('../../../src/commands/function_filter.js')).default
};
const UUID = '43aec1f0-095b-4a76-a9c8-934bf3d49d59';

/** Parse a command line against one command's builder, as cli.js does, without running the handler. */
function parse(command, argv) {
  const parseOnly = { command: command.command, describe: command.describe, builder: command.builder, handler: () => {} };
  return yargs(argv).command(parseOnly).exitProcess(false).fail((msg, err) => { throw err || new Error(msg); }).parse();
}

describe('Single function commands (function, auth, filter)', () => {
  afterEach(() => sinon.restore());

  for (const [name, command] of Object.entries(commands)) {
    describe(name, () => {
      it('requires the uuid positional', () => {
        expect(command.command).to.equal(`${name} <file> <description> <uuid>`);
        expect(() => parse(command, [name, 'a.js', 'A'])).to.throw(/Not enough non-option arguments|uuid/);
      });

      it('accepts any UUID shape, including the version digits deployed manifests use', async () => {
        const args = await parse(command, [name, 'a.js', 'A', '11111111-2222-9333-c444-555555555555']);
        expect(args.uuid).to.equal('11111111-2222-9333-c444-555555555555');
      });

      it('refuses a value that is not a UUID and suggests a new one', () => {
        expect(() => parse(command, [name, 'a.js', 'A', 'not-a-uuid'])).to.throw(/A function UUID is required .*for example [0-9a-f-]{36}/);
      });

      it('refuses a missing uuid in the handler before reading config or calling the API', async () => {
        const fromArgs = sinon.stub(config, 'fromArgs').resolves(true);
        try {
          await command.handler({ file: 'a.js', description: 'A' });
          expect.fail('must fail');
        } catch (error) { expect(error.message).to.include('A function UUID is required'); }
        expect(fromArgs.called).to.equal(false);
      });

      it('deploys with the given uuid and reports it', async () => {
        const deploy = sinon.stub().resolves({ uuid: UUID });
        const methods = { function: 'edgeFunction', auth: 'edgeAuth', filter: 'edgeFilter' };
        const context = { config: { fromArgs: sinon.stub().resolves(true) }, client: () => ({ [methods[name]]: deploy }) };

        const result = await command.handler.call(context, { file: 'a.js', description: 'A', uuid: UUID });

        expect(deploy.firstCall.args).to.deep.equal(['a.js', 'A', UUID]);
        expect(result).to.match(new RegExp(`^Deployed edge .*\\[${UUID}\\]$`));
      });

      it('shows the uuid in the example', () => {
        const examples = [];
        const y = { positional: () => y, example: (cmd) => { examples.push(cmd); return y; } };
        command.builder(y);
        expect(examples.join(' ')).to.include(UUID);
      });
    });
  }
});
