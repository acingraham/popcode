import test from 'tape';
import {testSaga} from 'redux-saga-test-plan';
import {
  createSnapshot as createSnapshotSaga,
  exportGist as exportGistSaga,
} from '../../../src/sagas/clients';
import {
  gistExported,
  gistExportError,
  snapshotCreated,
  snapshotExportError,
} from '../../../src/actions/clients';
import Scenario from '../../helpers/Scenario';
import {createGistFromProject} from '../../../src/clients/github';
import {createProjectSnapshot} from '../../../src/clients/firebase';
import {getCurrentProject} from '../../../src/selectors';

test('createSnapshot()', (t) => {
  const {project} = new Scenario();
  const key = '123-456';

  function initiateSnapshot() {
    return testSaga(createSnapshotSaga).
      next().select(getCurrentProject).
      next(project.toJS()).call(createProjectSnapshot, project.toJS());
  }

  t.test('successful export', (assert) => {
    initiateSnapshot().
      next(key).put(snapshotCreated(key)).
      next().isDone();

    assert.end();
  });

  t.test('error', (assert) => {
    const error = new Error();
    initiateSnapshot().
      throw(error).
      put(snapshotExportError(error)).
      next().isDone();

    assert.end();
  });
});

test('exportGist()', (t) => {
  const url = 'https://gist.github.com/abc123';
  const scenario = new Scenario();
  scenario.logIn();

  function initiateExport(assert) {
    return testSaga(exportGistSaga).
      next().inspect((effect) => {
        assert.ok(effect.SELECT, 'invokes select effect');
      }).
      next(scenario.state).call(
        createGistFromProject,
        scenario.project.toJS(),
        scenario.user.toJS(),
      );
  }

  t.test('with successful export', (assert) => {
    initiateExport(assert).
      next({html_url: url}).put(gistExported(url)).
      next().isDone();
    assert.end();
  });

  t.test('with error', (assert) => {
    const error = new Error();
    initiateExport(assert).
      throw(error).put(gistExportError(error)).
      next().isDone();
    assert.end();
  });
});
