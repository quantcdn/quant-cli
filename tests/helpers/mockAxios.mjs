import axios from 'axios';
import sinon from 'sinon';

export default function mockAxiosForDeploy() {
  // Mock the axios instance methods
  const mockInstance = {
    request: sinon.stub().resolves({ data: { success: true } }),
    get: sinon.stub().resolves({ data: { project: 'test-project' } }),
    post: sinon.stub().resolves({ data: { success: true } }),
    patch: sinon.stub().resolves({ data: { success: true } })
  };

  // Mock axios.create to return our mock instance
  sinon.stub(axios, 'create').returns(mockInstance);

  return mockInstance;
}
