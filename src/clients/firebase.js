import Cookies from 'js-cookie';
import get from 'lodash/get';
import isNil from 'lodash/isNil';
import isNull from 'lodash/isNull';
import values from 'lodash/values';
import uuid from 'uuid/v4';
import {auth, database, githubAuthProvider} from '../services/appFirebase';
import {Observable} from '../services/rxjs';

const VALID_SESSION_UID_COOKIE = 'firebaseAuth.validSessionUid';
const SESSION_TTL_MS = 5 * 60 * 1000;

const loginStateSource = Observable.create((observer) => {
  auth.onAuthStateChanged(observer.next.bind(observer));
}).switchMap((user) => {
  if (isNull(user)) {
    return Observable.of(null);
  }

  return Observable.fromPromise(userCredentialForUserData(user));
});

const [logOutSource, logInSource] = loginStateSource.skip(1).partition(isNull);

function workspace(uid) {
  return database.ref(`workspaces/${uid}`);
}

const snapshots = database.ref('snapshots');

async function getCurrentProjectKey(uid) {
  const event =
    await workspace(uid).child('currentProjectKey').once('value');
  return event.val();
}

export async function setCurrentProjectKey(uid, projectKey) {
  await workspace(uid).child('currentProjectKey').set(projectKey);
}

export async function loadAllProjects(uid) {
  const projects = await workspace(uid).child('projects').once('value');
  return values(projects.val() || {});
}

async function loadProject(uid, projectKey) {
  const event =
    await workspace(uid).child('projects').child(projectKey).once('value');
  return event.val();
}

export async function createProjectSnapshot(project) {
  const snapshotKey = uuid().toString();
  await snapshots.child(snapshotKey).set(project);
  return snapshotKey;
}

export async function loadProjectSnapshot(snapshotKey) {
  const event = await snapshots.child(snapshotKey).once('value');
  return event.val();
}

export async function loadCurrentProject(uid) {
  const projectKey = await getCurrentProjectKey(uid);
  if (projectKey) {
    return loadProject(uid, projectKey);
  }
  return null;
}

async function saveProject(uid, project) {
  await workspace(uid).child('projects').child(project.projectKey).
    setWithPriority(project, -Date.now());
}

export async function saveCurrentProject(uid, project) {
  return Promise.all([
    saveProject(uid, project),
    setCurrentProjectKey(uid, project.projectKey),
  ]);
}

async function userCredentialForUserData(user) {
  const path = providerPath(user.uid, user.providerData[0].providerId);
  const [credentialEvent, providerInfoEvent] = await Promise.all([
    database.ref(`authTokens/${path}`).once('value'),
    database.ref(`providerInfo/${path}`).once('value'),
  ]);
  const credential = credentialEvent.val();
  const additionalUserInfo = providerInfoEvent.val();
  if (isNil(credential)) {
    await auth.signOut();
    return null;
  }

  return {user, credential, additionalUserInfo};
}

export async function getInitialUserState() {
  const userCredential = await oneAuth();

  if (!isNull(userCredential)) {
    if (isNull(userCredential.credential)) {
      await auth.signOut();
      return null;
    }

    if (userCredential.user.uid !== getSessionUid()) {
      await auth.signOut();
      return null;
    }
  }

  return userCredential;
}

export function onSignedIn(handler) {
  logInSource.subscribe(handler);
}

export function onSignedOut(handler) {
  logOutSource.subscribe(handler);
}

export async function signIn() {
  const userCredential = await auth.signInWithPopup(githubAuthProvider);
  await saveUserCredential(userCredential);
  return userCredential;
}

export function signOut() {
  return auth.signOut();
}

async function saveUserCredential({
  user: {uid},
  credential,
  additionalUserInfo,
}) {
  await Promise.all([
    saveProviderInfo(uid, additionalUserInfo),
    saveCredentials(uid, credential),
  ]);
}

async function saveCredentials(uid, credential) {
  await database.
    ref(`authTokens/${providerPath(uid, credential.providerId)}`).
    set(credential);
}

async function saveProviderInfo(uid, providerInfo) {
  await database.
    ref(`providerInfo/${providerPath(uid, providerInfo.providerId)}`).
    set(providerInfo);
}

function providerPath(uid, providerId) {
  return `${uid}/${providerId.replace('.', '_')}`;
}

export function startSessionHeartbeat() {
  setInterval(setSessionUid, 1000);
}

function oneAuth() {
  return loginStateSource.first().toPromise();
}

function getSessionUid() {
  return Cookies.get(VALID_SESSION_UID_COOKIE);
}

export function setSessionUid() {
  Cookies.set(
    VALID_SESSION_UID_COOKIE,
    get(auth, 'currentUser.uid'),
    {expires: new Date(Date.now() + SESSION_TTL_MS)},
  );
}
